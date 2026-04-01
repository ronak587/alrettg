const axios = require("axios");

const TELEGRAM_TOKEN = "6906472163:AAH4N66rOmZMpSbQiva9qPczmF2iKcffNhg";
const CHAT_ID = "5108111483";

const LOGIN_URL = "https://ace.tor-iot.com/api/EquipAccount/EquipAppLogin";
const DATA_URL = "https://ace.tor-iot.com/api/equipapp/EquipAppMachineSpecification/EquipAppDetails?EquipmentId=47206";

const GEO_API_KEY = "4c44402d126d4946b63d71f17b2035a5";

let AUTH_TOKEN = "";
let isLoggingIn = false;
let isRunning = false;

let state = {
  engine: "OFF",
  motion: null,
  fuelAlert: false,
  lastLat: null,
  lastLng: null,
  locationName: "Unknown"
};

async function sendMessage(msg) {
  console.log("\n📩 TELEGRAM:\n", msg);
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: msg
  });
}

async function login() {
  const res = await axios.post(LOGIN_URL, {
    username: "pawanm",
    password: "PawaN@1",
    fcmToken: ""
  });
  return res.data.authToken;
}

async function getLocationName(lat, lng) {
  try {
    const res = await axios.get(`https://api.opencagedata.com/geocode/v1/json?q=${lat}+${lng}&key=${GEO_API_KEY}`);
    return res.data.results[0].formatted;
  } catch {
    return "Unknown Location";
  }
}

async function getData() {
  try {
    const res = await axios.get(DATA_URL, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` }
    });
    return res.data.table;
  } catch (err) {
    if (err.response && err.response.status === 401) {
      if (isLoggingIn) return;
      isLoggingIn = true;
      AUTH_TOKEN = await login();
      isLoggingIn = false;
      return getData();
    }
  }
}

async function sendFull(data, alerts, motion) {
  const live = data.liveParameter2 && Object.keys(data.liveParameter2).length ? data.liveParameter2 : data.liveParameter;
  const details = data.equipDetails;

  const lat = live.Latitude;
  const lng = live.Longitude;

  if (lat !== state.lastLat || lng !== state.lastLng) {
    state.locationName = await getLocationName(lat, lng);
    state.lastLat = lat;
    state.lastLng = lng;
  }

  const msg = `
🚜 MACHINE UPDATE

🆔 ${details.equipmentCode}
👤 ${details.customerName}
📍 ${state.locationName}

⚙️ Engine: ${state.engine}
📌 Mode: ${motion}

🕒 ${new Date().toLocaleString()}

📊 DATA
⚡ RPM: ${live.Engine_Speed}
🚗 Speed: ${live.GPS_Speed} km/h
⛽ Fuel: ${live.Fuel_Level}%
🔋 Battery: ${live.Battery_voltage} V
🌡 Temp: ${live.Engine_Coolant_Temperature}°C
⏱ Hours: ${live.Total_Engine_Hours}

🚨 Alerts:
${alerts.join("\n")}

🗺 https://maps.google.com/?q=${lat},${lng}
`;

  await sendMessage(msg);
}

async function checkMachine() {
  if (isRunning) return;
  isRunning = true;

  try {
    const data = await getData();
    if (!data) return;

    const live = data.liveParameter2 && Object.keys(data.liveParameter2).length ? data.liveParameter2 : data.liveParameter;

    const rpm = live.Engine_Speed;
    const speed = live.GPS_Speed;
    const fuel = live.Fuel_Level;
    const battery = live.Battery_voltage;
    const temp = parseFloat(live.Engine_Coolant_Temperature);

    let alerts = [];
    let motion = state.motion;

    if (rpm > 0 && state.engine === "OFF") {
      alerts.push("🚜 Engine Started");
      state.engine = "ON";
    }

    if (rpm === 0 && state.engine === "ON") {
      alerts.push("🛑 Engine Stopped");
      state.engine = "OFF";
    }

    if (rpm === 0) {
      motion = "OFF";
    } else if (speed > 1) {
      motion = "MOVING";
    } else if (rpm > 900 && speed <= 1) {
      motion = "WORKING";
    } else {
      motion = "IDLE";
    }

    if (motion !== state.motion) {
      if (motion === "MOVING") alerts.push(`🚗 Moving (${speed} km/h)`);
      if (motion === "WORKING") alerts.push("⛏ Digging Started");
      if (motion === "IDLE") alerts.push("💤 Idle");
      if (motion === "OFF") alerts.push("🛑 Machine Off");
      state.motion = motion;
    }

    if (fuel < 25 && !state.fuelAlert) {
      alerts.push(`⛽ Low Fuel (${fuel}%)`);
      state.fuelAlert = true;
    }

    if (fuel > 30) {
      state.fuelAlert = false;
    }

    if (battery < 11) {
      alerts.push(`🔋 Low Battery (${battery}V)`);
    }

    if (temp > 100) {
      alerts.push(`🔥 Overheat (${temp}°C)`);
    }

    if (alerts.length > 0) {
      await sendFull(data, alerts, motion);
    }

  } finally {
    isRunning = false;
  }
}

async function start() {
  AUTH_TOKEN = await login();
  setInterval(checkMachine, 30000);
}

start();
