load('api_config.js');
load('api_events.js');
load('api_gpio.js');
load('api_timer.js');
load('api_sys.js');

load('api_bt_gap.js');
load('api_bt_gattc.js');
load('api_bt_gatts.js');

let btn = Cfg.get('board.btn1.pin');              // Built-in button GPIO

if (btn >= 0) {
  let btnCount = 0;
  let btnPull, btnEdge;
  if (Cfg.get('board.btn1.pull_up') ? GPIO.PULL_UP : GPIO.PULL_DOWN) {
    btnPull = GPIO.PULL_UP;
    btnEdge = GPIO.INT_EDGE_NEG;
  } else {
    btnPull = GPIO.PULL_DOWN;
    btnEdge = GPIO.INT_EDGE_POS;
  }
  GPIO.set_button_handler(btn, btnPull, btnEdge, 20, function() {
    GAP.scan(1000, false);
  }, null);
}

let addr = null;

Event.on(GAP.EV_SCAN_RESULT, function(ev, evdata) {
  let sr = GAP.getScanResultArg(evdata);
  let name = GAP.parseName(sr.advData);
  print(JSON.stringify(sr), name);
  if (name === 'esp32_056B8C') addr = sr.addr;
}, null);

Event.on(GAP.EV_SCAN_STOP, function(ev, evdata) {
  if (!addr) return;
  print('Connecting to', addr);
  GATTC.connect(addr);
}, null);

function disconnect(conn) {
  print('Disconnecting from', conn.addr)
  GATTC.disconnect(conn.connId);
}

Event.on(GATTC.EV_CONNECT, function(ev, evdata) {
  let conn = GATTC.getConnectArg(evdata);
  print('Enumerating services on', conn.addr, conn.connId);
  GATTC.discover(conn.connId);
  Timer.set(5000, 0, disconnect, conn);
}, null);

Event.on(GATTC.EV_DISCOVERY_RESULT, function(ev, evdata) {
  let dr = GATTC.getDiscoveryResultArg(evdata);
  print('Found', JSON.stringify(dr));
  if (dr.chr === '11111111-90ab-cdef-0123-456789abcdef') {
    GATTC.read(dr.conn.connId, dr.handle);
  } else if (dr.chr === '22222222-90ab-cdef-0123-456789abcdef') {
    GATTC.read(dr.conn.connId, dr.handle);
  }
}, null);

Event.on(GATTC.EV_READ_RESULT, function(ev, evdata) {
  let rd = GATTC.getReadResult(evdata);
  print('Read data:', rd.handle, rd.data);
}, null);

Event.on(GATTC.EV_NOTIFY, function(ev, evdata) {
  let na = GATTC.getNotifyArg(evdata);
  print('Got notification:', na.data);
}, null);

Event.on(Event.CLOUD_CONNECTED, function() {
  online = true;
  Shadow.update(0, {ram_total: Sys.total_ram()});
}, null);

Event.on(Event.CLOUD_DISCONNECTED, function() {
  online = false;
}, null);

let subscriber = undefined;

GATTS.registerService(
   "12345678-90ab-cdef-0123-456789abcdef",
   GATT.SEC_LEVEL_NONE,
   [
     ["11111111-90ab-cdef-0123-456789abcdef", GATT.PROP_READ],
     ["22222222-90ab-cdef-0123-456789abcdef", GATT.PROP_RWNI(1, 1, 1, 0)],
   ],
   function svch(c, ev, arg) {
     print(JSON.stringify(c), ev, arg, JSON.stringify(arg));
     if (ev === GATTS.EV_CONNECT) {
       print(c.addr, "connected");
       return GATT.STATUS_OK;
     } else if (ev === GATTS.EV_READ) {
       if (arg.uuid === "11111111-90ab-cdef-0123-456789abcdef") {
         GATTS.sendRespData(c, arg, "Hello");
       } else if (arg.uuid === "22222222-90ab-cdef-0123-456789abcdef") {
         GATTS.sendRespData(c, arg, "world");
       }
       return GATT.STATUS_OK;
     } else if (ev === GATTS.EV_WRITE) {
       print("Thank you for " + arg.data + ", " + c.addr);
       return GATT.STATUS_OK;
     } else if (ev === GATTS.EV_NOTIFY_MODE) {
       if (arg.mode !== GATT.NOTIFY_MODE_OFF) {
         print(c.addr + " subscribed");
         subscriber = { c: c, mode: arg.mode, handle: arg.handle };
       } else {
         print(c.addr + " unsubscribed");
         subscriber = undefined;
       }
     } else if (ev === GATTS.EV_DISCONNECT) {
       print(c.addr, "disconnected");
       subscriber = undefined;
       return GATT.STATUS_OK;
     }
     return GATT.STATUS_REQUEST_NOT_SUPPORTED;
   });

Timer.set(1000, Timer.REPEAT, function() {
  if (!subscriber) return;
  let se = subscriber;
  let data = JSON.stringify({up: Sys.uptime()});
  GATTS.notify(se.c, se.mode, se.handle, data);
}, null);
