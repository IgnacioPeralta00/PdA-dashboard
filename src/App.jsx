import { useEffect, useState } from 'react'
import mqtt from 'mqtt'
import './App.css'


// CONFIGURACIÓN DEL EXAMEN (Editar durante la prueba)
const MQTT_URL = import.meta.env.VITE_MQTT_URL || 'ws://localhost:9001'

const CONFIG_EXAMEN = {
  titulo: "Dashboard de Evaluación",
  ubicacion: "Laboratorio IoT",

  // Sensor 1 (Aparece en la tarjeta grande y en la gráfica)
  sensorPrincipal: {
    topic: import.meta.env.VITE_MQTT_TOPIC_1 || 'examen/esp32/sensor1',
    label: 'DISTANCIA',
    unit: 'cm',
    icon: '⌖'
  },

  // Sensor 2 (Primera tarjeta pequeña)
  sensorSecundario: {
    topic: import.meta.env.VITE_MQTT_TOPIC_2 || 'examen/esp32/sensor2',
    label: 'HUMEDAD',
    unit: '%',
    icon: '≈',
    colorClass: 'blue' // Opciones: 'blue', 'yellow'
  },

  // Sensor 3 (Segunda tarjeta pequeña)
  sensorTerciario: {
    topic: import.meta.env.VITE_MQTT_TOPIC_3 || 'examen/esp32/sensor3',
    label: 'PRESION',
    unit: 'hPa',
    icon: '☼',
    colorClass: 'yellow' // Opciones: 'blue', 'yellow'
  }
}
// ==============================================================

const fallbackReading = { sensor1: 0, sensor2: 0, sensor3: 0 }
const fallbackHistory = [0, 0, 0, 0, 0]

// Función genérica para extraer números sin importar cómo los envíes
function parseSensorValue(message) {
  const text = message.toString().trim()
  // Intenta parsear directamente como número
  const directNum = parseFloat(text)
  if (!isNaN(directNum)) return directNum

  // Si envías un JSON desde el ESP32, busca cualquier valor numérico
  try {
    const payload = JSON.parse(text)
    const val = Object.values(payload).find(item => typeof item === 'number')
    return val !== undefined ? Number(val) : 0
  } catch {
    return 0
  }
}

function App() {
  const [reading, setReading] = useState(fallbackReading)
  const [mainHistory, setMainHistory] = useState(fallbackHistory)
  const [connectionState, setConnectionState] = useState('Conectando...')

  useEffect(() => {
    const client = mqtt.connect(MQTT_URL, { reconnectPeriod: 3000, connectTimeout: 10000 })

    // Extraemos los topics dinámicamente de la configuración
    const topics = [
      CONFIG_EXAMEN.sensorPrincipal.topic,
      CONFIG_EXAMEN.sensorSecundario.topic,
      CONFIG_EXAMEN.sensorTerciario.topic
    ]

    client.on('connect', () => {
      console.info('[MQTT] Conectado a', MQTT_URL)
      setConnectionState('Sistema en linea')
      topics.forEach((topic) => {
        client.subscribe(topic, (error) => {
          if (error) setConnectionState('Error de suscripcion')
        })
      })
    })

    client.on('reconnect', () => setConnectionState('Reconectando...'))
    client.on('offline', () => setConnectionState('Sin conexion'))
    client.on('error', () => setConnectionState('Error de conexion'))

    client.on('message', (topic, message) => {
      const value = parseSensorValue(message)
      if (!Number.isFinite(value)) return

      setReading((current) => {
        if (topic === CONFIG_EXAMEN.sensorPrincipal.topic) return { ...current, sensor1: value }
        if (topic === CONFIG_EXAMEN.sensorSecundario.topic) return { ...current, sensor2: value }
        if (topic === CONFIG_EXAMEN.sensorTerciario.topic) return { ...current, sensor3: value }
        return current
      })

      // Guarda el historial solo del sensor principal para la gráfica
      if (topic === CONFIG_EXAMEN.sensorPrincipal.topic) {
        setMainHistory((history) => [...history.slice(-4), value])
      }
    })

    return () => client.end(true)
  }, [])

  // Preparación de datos para la gráfica (se auto-escala según los valores)
  const history = mainHistory.slice(-5)
  const minVal = Math.min(...history) - 5
  const maxVal = Math.max(...history) + 5
  const range = maxVal - minVal === 0 ? 1 : maxVal - minVal

  const points = history.map((val, index) => {
    const x = history.length === 1 ? 300 : 25 + index * (550 / (history.length - 1))
    const y = 145 - ((val - minVal) / range) * 100
    return `${x},${Math.max(35, Math.min(145, y))}`
  }).join(' ')

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◒</span><span>Examen<span className="brand-accent">IoT</span></span>
        </div>
        <nav className="nav-list" aria-label="Navegacion principal">
          <a className="nav-item active" href="#dashboard"><span>⌂</span> Dashboard</a>
        </nav>
        <div className="sidebar-footer">
          <div className={`status-dot ${connectionState === 'Sistema en linea' ? '' : 'status-warning'}`}></div>
          <div><strong>{connectionState}</strong><small>MQTT · Activo</small></div>
        </div>
      </aside>

      <main className="main-content" id="dashboard">
        <header className="topbar">
          <div><h1>{CONFIG_EXAMEN.titulo}</h1></div>
        </header>
        <section className="location-row">
          <div><span className="location-pin">⌖</span><strong>{CONFIG_EXAMEN.ubicacion}</strong></div>
        </section>

        <section className="dashboard-grid">
          {/* SENSOR PRINCIPAL */}
          <article className="current-weather card">
            <div className="weather-heading">
              <div>
                <p className="label">{CONFIG_EXAMEN.sensorPrincipal.label}</p>
                <h2>Medición Actual</h2>
              </div>
              <span className="weather-symbol">{CONFIG_EXAMEN.sensorPrincipal.icon}</span>
            </div>
            <div className="current-temperature">
              {reading.sensor1}<span>{CONFIG_EXAMEN.sensorPrincipal.unit}</span>
            </div>
          </article>

          {/* SENSOR SECUNDARIO */}
          <article className="metric-card card">
            <div className={`metric-icon ${CONFIG_EXAMEN.sensorSecundario.colorClass}`}>{CONFIG_EXAMEN.sensorSecundario.icon}</div>
            <div>
              <p className="label">{CONFIG_EXAMEN.sensorSecundario.label}</p>
              <strong>{reading.sensor2}<span>{CONFIG_EXAMEN.sensorSecundario.unit}</span></strong>
              <p className="metric-caption">Lectura en tiempo real</p>
            </div>
          </article>

          {/* SENSOR TERCIARIO */}
          <article className="metric-card card">
            <div className={`metric-icon ${CONFIG_EXAMEN.sensorTerciario.colorClass}`}>{CONFIG_EXAMEN.sensorTerciario.icon}</div>
            <div>
              <p className="label">{CONFIG_EXAMEN.sensorTerciario.label}</p>
              <strong>{reading.sensor3}<span>{CONFIG_EXAMEN.sensorTerciario.unit}</span></strong>
              <p className="metric-caption">Lectura en tiempo real</p>
            </div>
          </article>

          {/* GRÁFICA DEL SENSOR PRINCIPAL */}
          <article className="forecast-card card" id="pronostico">
            <div className="card-header">
              <div>
                <p className="label">HISTORIAL RECIENTE</p>
                <h2>Últimas 5 mediciones ({CONFIG_EXAMEN.sensorPrincipal.label})</h2>
              </div>
            </div>
            <div className="line-chart">
              <svg viewBox="0 0 600 190" role="img" preserveAspectRatio="none">
                <line className="chart-gridline" x1="0" y1="35" x2="600" y2="35" />
                <line className="chart-gridline" x1="0" y1="85" x2="600" y2="85" />
                <line className="chart-gridline" x1="0" y1="135" x2="600" y2="135" />
                <polyline className="chart-line" points={points} />
                {history.map((val, index) => {
                  const x = history.length === 1 ? 300 : 25 + index * (550 / (history.length - 1));
                  const y = Math.max(35, Math.min(145, 145 - ((val - minVal) / range) * 100));
                  return <circle className="chart-point" cx={x} cy={y} r="5" key={`pt-${index}`} />
                })}
              </svg>
              <div className="chart-labels">
                {history.map((val, index) => <span key={`lbl-${index}`}><strong>{val}</strong></span>)}
              </div>
            </div>
          </article>
        </section>
      </main>
    </div>
  )
}

export default App