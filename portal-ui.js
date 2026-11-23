const byId = id => document.getElementById(id);
const status = byId('note');
async function api(path, data) {
  const response = await fetch('/api/' + path, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}
function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
async function refresh() {
  let state;
  try { state = await api('state'); }
  catch (error) {
    if (error.status !== 401) throw error;
    byId('portal').hidden = true;
    byId('login-area').hidden = false;
    byId('mode').textContent = 'Acceso a la VPN';
    return;
  }
  const { user, devices, users, live, endpoint, serverKey } = state;
  const admin = user.role === 'admin';
  byId('login-area').hidden = true;
  byId('portal').hidden = false;
  byId('admin').hidden = !admin;
  byId('sample').hidden = live;
  byId('mode').textContent = (live ? endpoint : 'Modo demostración · sin tráfico VPN') + ' · ' + user.email;
  byId('owners').replaceChildren(...users.map(user => new Option(user.email, user.id)));
  byId('devices').replaceChildren(...devices.map(device => {
    const card = element('article', '');
    const address = '10.77.0.' + device.slot;
    const mode = device.mode === 'full' ? 'Internet por la VPN' : 'Red privada';
    card.append(element('h3', device.label), element('p', address + ' · ' + mode),
      element('p', device.active ? 'Acceso autorizado' : 'Acceso desactivado'),
      element('p', 'Última conexión: ' + (device.handshake ? new Date(device.handshake * 1000).toLocaleString() : 'Sin registro')));
    if (admin) {
      const button = element('button', device.active ? 'Revocar acceso' : 'Otorgar acceso');
      button.onclick = () => act(button, async () => {
        await api('access', { slot: device.slot, enabled: !device.active });
        await refresh();
      });
      card.append(button);
    }
    if (live && device.active) {
      const config = element('textarea', '');
      config.readOnly = true;
      config.rows = 10;
      config.setAttribute('aria-label', 'Plantilla WireGuard');
      const allowed = device.mode === 'full' ? '0.0.0.0/0, ::/0' : '10.77.0.0/24';
      const dns = device.mode === 'full' ? '\nDNS = 1.1.1.1' : '';
      config.value = `[Interface]\nPrivateKey = <CLAVE_PRIVADA_GENERADA_EN_ESTE_EQUIPO>\nAddress = ${address}/32${dns}\n\n[Peer]\nPublicKey = ${serverKey}\nEndpoint = ${endpoint}\nAllowedIPs = ${allowed}\nPersistentKeepalive = 25`;
      card.append(element('p', 'Completa esta plantilla en tu equipo con la clave privada que generaste allí.'), config);
    }
    return card;
  }));
  if (!devices.length) byId('devices').append(element('p', 'Todavía no hay puestos registrados.'));
}
async function act(control, action) {
  control.disabled = true;
  status.textContent = '';
  try { await action(); } catch (error) { status.textContent = error.message; }
  finally { control.disabled = false; }
}
for (const [id, route] of [['login', 'login'], ['new-user', 'users'], ['new-device', 'devices']]) {
  const form = byId(id);
  form.onsubmit = event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (data.owner) data.owner = Number(data.owner);
    act(form.querySelector('button:last-child'), async () => {
      await api(route, data);
      form.reset();
      await refresh();
    });
  };
}
byId('sample').onclick = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  byId('new-device').elements.publicKey.value = btoa(String.fromCharCode(...bytes));
};
byId('logout').onclick = () => act(byId('logout'), async () => {
  await api('logout', {});
  await refresh();
});
refresh().catch(error => { status.textContent = error.message; });
