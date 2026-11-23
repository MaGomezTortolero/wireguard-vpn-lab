# WireGuard VPN Lab

Laboratorio reproducible de acceso privado con WireGuard. Simula un cliente y un servidor Linux en dos espacios de nombres de red conectados por un par virtual Ethernet. El script crea un túnel, comprueba la conectividad y revoca el acceso del cliente para verificar que deja de recibir respuesta.

| Red | Servidor | Cliente |
| --- | --- | --- |
| Transporte simulado | `192.0.2.1/30` | `192.0.2.2/30` |
| Túnel WireGuard | `10.77.0.1/32` | `10.77.0.2/32` |

Cada extremo tiene una ruta de host hacia el otro. `AllowedIPs` asocia esa dirección con la clave pública del par. El laboratorio genera claves temporales con permisos restringidos y elimina los espacios de nombres y las claves al terminar. El puerto UDP 51820 se abre dentro del espacio de nombres del servidor.

## Ejecutar

Usa una máquina virtual Linux con soporte de WireGuard, espacios de nombres de red y privilegios de administrador. En Windows, puedes abrir el código en VS Code y ejecutar la prueba dentro de esa máquina virtual. En Debian o Ubuntu instala las dependencias así.

```bash
sudo apt install wireguard-tools iproute2 iputils-ping
bash -n lab.sh
sudo bash lab.sh
```

La prueba debe confirmar el intercambio de claves y la respuesta ICMP por el túnel. Después de retirar la clave pública del cliente, un segundo ping debe fallar. El script termina con código 0 cuando ambas comprobaciones pasan.

## English summary

A reproducible WireGuard lab that tests peer authentication, host-specific routes and access revocation across two isolated Linux network namespaces. Run `sudo bash lab.sh` in a Linux VM with WireGuard, iproute2 and iputils-ping.

[WireGuard quick start](https://www.wireguard.com/quickstart/)

## Portal de administración

El portal usa Node.js 24 y SQLite. En modo demostración permite entrar con correo y contraseña, crear usuarios, registrar puestos y simular la autorización y revocación. La base se crea localmente y las sesiones se conservan en memoria hasta reiniciar el proceso.

Abre una terminal en la carpeta del repo y ejecuta en PowerShell.

```powershell
$env:ADMIN_EMAIL = 'admin@example.test'
$env:ADMIN_PASSWORD = Read-Host 'Contraseña de administrador (mínimo 12 caracteres)' -MaskInput
node portal.mjs
```

Abre http://localhost:8787. Registra un puesto con el botón **Usar clave de demostración**, otórgale acceso y luego revócalo. La contraseña inicial solo se usa al crear la primera cuenta de administrador. La clave de demostración es para el simulador.

## Integración con WireGuard

Para una prueba real prepara una máquina virtual Linux dedicada. El portal se vincula a una interfaz WireGuard existente y administra únicamente los pares registrados en su base. Usa una interfaz exclusiva para el portal, con dirección del servidor `10.77.0.1/24` y puerto UDP 51820. El servidor necesita sus propias claves, y quienes conecten un equipo deben generar su clave privada en ese equipo y registrar solo la pública.

- Define `VPN_INTERFACE`, `VPN_ENDPOINT` (nombre o IP y puerto UDP) y `VPN_PUBLIC_KEY` (clave pública del servidor).
- Ejecuta el portal con un usuario de servicio con acceso a la base y a la interfaz WireGuard mediante `CAP_NET_ADMIN` en un entorno dedicado. El backend invoca `wg` directamente, lee los pares y el último handshake, y agrega o retira pares cuando el administrador cambia el acceso.
- En modo privado, la plantilla del cliente enruta `10.77.0.0/24` por WireGuard. En modo Internet, captura tráfico IPv4 e IPv6 y configura DNS. Para salida IPv4 habilita el reenvío y configura NAT en la interfaz pública. El tráfico IPv6 requiere direccionamiento y reenvío propios para funcionar. Verifica la política IPv6 del cliente antes de ofrecer salida completa.
- Los cambios de pares viven en la interfaz activa. Tras reiniciar WireGuard, revisa los puestos y vuelve a autorizar los que correspondan. Mantén la configuración inicial de la interfaz sin pares de este portal para que el reinicio deje el acceso cerrado.
- Mantén el panel en localhost para pruebas. Un despliegue accesible por red requiere HTTPS, el ajuste `HTTPS_PROXY_DEPLOYMENT=1`, controles de acceso al panel y gestión operativa de cuentas.

Para demostrar una IP de salida de EE. UU., el servidor debe ejecutarse allí y el cliente debe usar la plantilla de Internet. La región, el proveedor y las pruebas de conectividad pública quedan pendientes del despliegue.

## Prueba del laboratorio desde WSL 2

Git aplica finales de línea LF a `lab.sh` mediante `.gitattributes`. Si tu copia anterior tiene CRLF y está en `/mnt/c`, puedes ejecutar una copia convertida en el sistema de archivos de Ubuntu.

```bash
lab_copia=$(mktemp "$HOME/wireguard-lab.XXXXXX") &&
  sed 's/\r$//' lab.sh > "$lab_copia" &&
  sudo bash "$lab_copia"
```
