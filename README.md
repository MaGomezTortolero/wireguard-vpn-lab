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
