import { useEffect, useState } from 'react'
import mqtt from 'mqtt'
import './App.css'

const MQTT_URL = import.meta.env.VITE_MQTT_URL || 'ws://localhost:9001'

// Catálogo fijo de sensores con sus unidades listas
const SENSORES_CONFIG = [
  {
    id: 'temperatura',
    nombre: 'Temperatura',
    unidad: '°C',
    icono: '🌡',
    color: 'yellow',
    topic: import.meta.env.VITE_TOPIC_TEMP || 'examen/esp32/temperatura'
  },
  {
    id: 'humedad',
    nombre: 'Humedad',
    unidad: '%',
    icono: '≈',
    color: 'blue',
    topic: import.meta.env.VITE_TOPIC_HUM || 'examen/esp32/humedad'
  },
  {
    id: 'luz',
    nombre: 'Iluminación',
    unidad: '%',
    icono: '☼',
    color: 'yellow',
    topic: import.meta.env.VITE_TOPIC_LUZ || 'examen/esp32/luz'
  },
  {
    id: 'distancia',
    nombre: 'Distancia',
    unidad: 'cm',
    icono: '📏',
    color: 'green',
    topic: import.meta.env.VITE_TOPIC_DIST || 'examen/esp32/distancia'
  }
]

// Catálogo de botones genéricos (ON/OFF)
const ACTUADORES_CONFIG = [
  {
    id: 'boton1',
    nombre: 'Botón 1',
    icono: '🔘',
    topic: import.meta.env.VITE_TOPIC_BTN1 || 'examen/esp32/boton1',
    labelOn: 'ENCENDER (ON)',
    labelOff: 'APAGAR (OFF)'
  },
  {
    id: 'boton2',
    nombre: 'Botón 2',
    icono: '🔘',
    topic: import.meta.env.VITE_TOPIC_BTN2 || 'examen/esp32/boton2',
    labelOn: 'ENCENDER (ON)',
    labelOff: 'APAGAR (OFF)'
  }
]

const TOPIC_MENSAJE = import.meta.env.VITE_TOPIC_MSG || 'examen/esp32/mensaje'

// Extrae números para los sensores
function parseNumericValue(message) {
  const text = message.toString().trim()
  const num = parseFloat(text)
  if (!isNaN(num)) return num
  try {
    const data = JSON.parse(text)
    const val = Object.values(data).find((v) => typeof v === 'number')
    return val !== undefined ? Number(val) : NaN
  } catch {
    return NaN
  }
}

// Componente para dibujar la fila Tarjeta | Gráfica de cada sensor
function FilaSensor({ config, valor, historial }) {
  const history = historial.slice(-5)
  const minVal = Math.min(...history) - 2
  const maxVal = Math.max(...history) + 2
  const range = maxVal - minVal === 0 ? 1 : maxVal - minVal

  const points = history
    .map((val, index) => {
      const x = history.length === 1 ? 300 : 25 + index * (550 / (history.length - 1))
      const y = 105 - ((val - minVal) / range) * 80
      return `${x},${Math.max(20, Math.min(105, y))}`
    })
    .join(' ')

  return (
    <div className="sensor-row">
      {/* LADO IZQUIERDO: TARJETA */}
      <article className="card sensor-info-card">
        <div className="sensor-header">
          <div>
            <p className="label">SENSOR ACTIVO</p>
            <h2 style={{ margin: 0, fontSize: '20px' }}>{config.nombre}</h2>
          </div>
          <div className={`metric-icon ${config.color}`}>{config.icono}</div>
        </div>
        <div className="sensor-reading">
          {valor}
          <span>{config.unidad}</span>
        </div>
        <div>
          <span className="topic-badge">Topic: {config.topic}</span>
        </div>
      </article>

      {/* LADO DERECHO: GRÁFICA DE ÚLTIMAS 5 MEDICIONES */}
      <article className="card sensor-chart-card">
        <div className="chart-header">
          <div>
            <p className="label">HISTORIAL EN TIEMPO REAL</p>
            <h3>Últimas 5 mediciones de {config.nombre}</h3>
          </div>
          <span className="topic-badge">{config.unidad}</span>
        </div>

        <div className="line-chart">
          <svg viewBox="0 0 600 125" role="img" preserveAspectRatio="none">
            <line className="chart-gridline" x1="0" y1="25" x2="600" y2="25" />
            <line className="chart-gridline" x1="0" y1="65" x2="600" y2="65" />
            <line className="chart-gridline" x1="0" y1="105" x2="600" y2="105" />
            <polyline className="chart-line" points={points} />
            {history.map((val, index) => {
              const x = history.length === 1 ? 300 : 25 + index * (550 / (history.length - 1))
              const y = Math.max(20, Math.min(105, 105 - ((val - minVal) / range) * 80))
              return <circle className="chart-point" cx={x} cy={y} r="4.5" key={`pt-${index}`} />
            })}
          </svg>
          <div className="chart-labels">
            {history.map((val, index) => (
              <span key={`lbl-${index}`}>
                <strong>
                  {val} {config.unidad}
                </strong>
              </span>
            ))}
          </div>
        </div>
      </article>
    </div>
  )
}

function App() {
  const [mqttClient, setMqttClient] = useState(null)
  const [connectionState, setConnectionState] = useState('Conectando...')

  // Estado que controla qué módulos están visibles en el dashboard (se guarda en el navegador)
  const [visibles, setVisibles] = useState(() => {
    const guardado = localStorage.getItem('modulos_examen_iot_v2')
    return guardado
      ? JSON.parse(guardado)
      : {
        temperatura: true,
        humedad: false,
        luz: false,
        distancia: true,
        boton1: true,
        boton2: false,
        mensaje: true
      }
  })

  // Valores actuales de los 4 sensores
  const [valores, setValores] = useState({
    temperatura: 0,
    humedad: 0,
    luz: 0,
    distancia: 0
  })

  // Historial independiente (últimas 5 lecturas) para cada sensor
  const [historiales, setHistoriales] = useState({
    temperatura: [0, 0, 0, 0, 0],
    humedad: [0, 0, 0, 0, 0],
    luz: [0, 0, 0, 0, 0],
    distancia: [0, 0, 0, 0, 0]
  })

  // Estado de los botones y del texto recibido
  const [estadoActuadores, setEstadoActuadores] = useState({ boton1: 'OFF', boton2: 'OFF' })
  const [mensajeRecibido, setMensajeRecibido] = useState({
    texto: 'Esperando mensaje...',
    hora: '--:--:--'
  })

  // Guardar la selección de paneles cada vez que apagas/enciendes uno en la barra lateral
  useEffect(() => {
    localStorage.setItem('modulos_examen_iot_v2', JSON.stringify(visibles))
  }, [visibles])

  useEffect(() => {
    const client = mqtt.connect(MQTT_URL, { reconnectPeriod: 3000, connectTimeout: 10000 })
    setMqttClient(client)

    const topicsASuscribir = [
      ...SENSORES_CONFIG.map((s) => s.topic),
      TOPIC_MENSAJE
    ]

    client.on('connect', () => {
      setConnectionState('Sistema en línea')
      topicsASuscribir.forEach((topic) => {
        client.subscribe(topic)
      })
    })

    client.on('reconnect', () => setConnectionState('Reconectando...'))
    client.on('offline', () => setConnectionState('Sin conexión'))
    client.on('error', () => setConnectionState('Error de conexión'))

    client.on('message', (topic, message) => {
      // 1. ¿Es un mensaje de texto?
      if (topic === TOPIC_MENSAJE) {
        const textoLimpio = message.toString().trim()
        const ahora = new Date().toLocaleTimeString()
        setMensajeRecibido({ texto: textoLimpio, hora: ahora })
        return
      }

      // 2. ¿Es alguno de los sensores numéricos?
      const sensorEncontrado = SENSORES_CONFIG.find((s) => s.topic === topic)
      if (sensorEncontrado) {
        const num = parseNumericValue(message)
        if (!Number.isFinite(num)) return

        const id = sensorEncontrado.id
        setValores((prev) => ({ ...prev, [id]: num }))
        setHistoriales((prev) => ({
          ...prev,
          [id]: [...prev[id].slice(-4), num]
        }))
      }
    })

    return () => client.end(true)
  }, [])

  // Función para activar/ocultar tarjetas desde el menú izquierdo
  const toggleModulo = (id) => {
    setVisibles((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  // Función para enviar "ON" u "OFF" al ESP32
  const enviarComando = (actuador, comando) => {
    if (!mqttClient) return
    mqttClient.publish(actuador.topic, comando)
    setEstadoActuadores((prev) => ({ ...prev, [actuador.id]: comando }))
  }

  const sensoresActivos = SENSORES_CONFIG.filter((s) => visibles[s.id])
  const actuadoresActivos = ACTUADORES_CONFIG.filter((a) => visibles[a.id])

  return (
    <div className="app-shell">
      {/* BARRA LATERAL CON INTERRUPTORES */}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◒</span>
          <span>Panel<span className="brand-accent">IoT</span></span>
        </div>

        <div className="sidebar-section-title">Sensores (Tarjeta + Gráfica)</div>
        <div className="module-toggles">
          {SENSORES_CONFIG.map((sensor) => (
            <button
              key={sensor.id}
              className={`toggle-btn ${visibles[sensor.id] ? 'active' : ''}`}
              onClick={() => toggleModulo(sensor.id)}
            >
              <span>{sensor.icono} {sensor.nombre} ({sensor.unidad})</span>
              <span className="toggle-indicator" />
            </button>
          ))}
        </div>

        <div className="sidebar-section-title">Controles (Botones)</div>
        <div className="module-toggles">
          {ACTUADORES_CONFIG.map((act) => (
            <button
              key={act.id}
              className={`toggle-btn ${visibles[act.id] ? 'active' : ''}`}
              onClick={() => toggleModulo(act.id)}
            >
              <span>{act.icono} {act.nombre}</span>
              <span className="toggle-indicator" />
            </button>
          ))}
        </div>

        <div className="sidebar-section-title">Mensajes</div>
        <div className="module-toggles">
          <button
            className={`toggle-btn ${visibles.mensaje ? 'active' : ''}`}
            onClick={() => toggleModulo('mensaje')}
          >
            <span>💬 Mensaje</span>
            <span className="toggle-indicator" />
          </button>
        </div>

        <div className="sidebar-footer">
          <div className={`status-dot ${connectionState === 'Sistema en línea' ? '' : 'status-warning'}`} />
          <div>
            <strong>{connectionState}</strong>
            <small>{MQTT_URL}</small>
          </div>
        </div>
      </aside>

      {/* VISTA PRINCIPAL */}
      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="label">PANEL MODULAR DE EVALUACIÓN</p>
            <h1>Monitor y Control en Tiempo Real</h1>
          </div>
        </header>

        {/* BLOQUE 1: FILAS DE SENSORES (TARJETA | GRÁFICA) */}
        <section className="sensors-list">
          {sensoresActivos.map((sensor) => (
            <FilaSensor
              key={sensor.id}
              config={sensor}
              valor={valores[sensor.id]}
              historial={historiales[sensor.id]}
            />
          ))}
        </section>

        {/* BLOQUE 2: CONTROLES Y MENSAJES (SIN GRÁFICA) */}
        {(actuadoresActivos.length > 0 || visibles.mensaje) && (
          <section className="utility-grid">
            {/* Tarjetas de botones ON / OFF */}
            {actuadoresActivos.map((act) => (
              <article key={act.id} className="card">
                <div className="sensor-header">
                  <div>
                    <p className="label">CONTROL REMOTO</p>
                    <h2 style={{ margin: 0, fontSize: '19px' }}>{act.nombre}</h2>
                  </div>
                  <div className="metric-icon purple">{act.icono}</div>
                </div>
                <p style={{ margin: '10px 0 6px', fontSize: '12px', color: '#71808a' }}>
                  Publica en: <code>{act.topic}</code>
                </p>
                <div className="actuator-controls">
                  <button
                    className={`btn-action btn-on ${estadoActuadores[act.id] === 'ON' ? 'selected' : ''}`}
                    onClick={() => enviarComando(act, 'ON')}
                  >
                    {act.labelOn}
                  </button>
                  <button
                    className={`btn-action btn-off ${estadoActuadores[act.id] === 'OFF' ? 'selected' : ''}`}
                    onClick={() => enviarComando(act, 'OFF')}
                  >
                    {act.labelOff}
                  </button>
                </div>
              </article>
            ))}

            {/* Tarjeta de Mensajes */}
            {visibles.mensaje && (
              <article className="card">
                <div className="sensor-header">
                  <div>
                    <p className="label">RECEPTOR DE TEXTO</p>
                    <h2 style={{ margin: 0, fontSize: '19px' }}>Mensaje</h2>
                  </div>
                  <div className="metric-icon blue">💬</div>
                </div>
                <p style={{ margin: '10px 0 6px', fontSize: '12px', color: '#71808a' }}>
                  Escuchando en: <code>{TOPIC_MENSAJE}</code>
                </p>
                <div className="message-box">
                  <span>{mensajeRecibido.texto}</span>
                  <span className="message-time">{mensajeRecibido.hora}</span>
                </div>
              </article>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

export default App