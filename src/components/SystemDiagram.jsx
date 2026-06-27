// Visual power-flow diagram — shows the customer's system as a journey from sun to socket

function FlowArrow() {
  return (
    <div className="flex flex-col items-center justify-center px-1 py-2 text-gray-300 shrink-0">
      <div className="hidden sm:block text-2xl leading-none">→</div>
      <div className="block sm:hidden text-2xl leading-none rotate-90">→</div>
    </div>
  )
}

function ZoneBox({ icon, zone, title, color, items }) {
  const colors = {
    yellow: { bg: 'bg-amber-50',   border: 'border-amber-300', header: 'bg-amber-400',   text: 'text-amber-900'  },
    blue:   { bg: 'bg-blue-50',    border: 'border-blue-300',  header: 'bg-blue-600',    text: 'text-white'      },
    green:  { bg: 'bg-emerald-50', border: 'border-emerald-300',header: 'bg-emerald-500', text: 'text-white'      },
    purple: { bg: 'bg-purple-50',  border: 'border-purple-300',header: 'bg-purple-600',  text: 'text-white'      },
  }[color]

  return (
    <div className={`rounded-xl border-2 ${colors.border} ${colors.bg} overflow-hidden flex-1 min-w-[130px] max-w-[200px]`}>
      <div className={`${colors.header} ${colors.text} px-3 py-1.5 text-center`}>
        <div className="text-xs font-black uppercase tracking-wider">{zone}</div>
        <div className="text-xs font-semibold opacity-90">{title}</div>
      </div>
      <div className="p-3 space-y-1.5">
        <div className="text-2xl text-center mb-1">{icon}</div>
        {items.map((item, i) => (
          <div key={i} className="text-xs text-gray-700 text-center font-semibold leading-snug">
            {item}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SystemDiagram({ panelQty, inverterQty, batteryQty, results, tier }) {
  const { engineering: eng, tierLabel } = results
  const panelW = (results.truePVkW * 1000 / panelQty).toFixed(0)

  return (
    <div className="bg-gradient-to-br from-slate-900 to-blue-950 rounded-2xl p-5 text-white">
      <h3 className="text-sm font-bold uppercase tracking-widest text-blue-300 mb-4 text-center">
        ☀️ Your System Journey — From Sun to Socket
      </h3>

      {/* Flow diagram */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-0">

        {/* SOURCE */}
        <div className="flex flex-col items-center min-w-[110px]">
          <div className="text-3xl mb-1">☀️</div>
          <div className="text-xs font-black text-amber-300 text-center uppercase tracking-wide">Sunlight</div>
          <div className="text-xs text-gray-400 text-center mt-0.5">{eng.peakSunHours} hrs/day</div>
        </div>

        <FlowArrow />

        {/* ZONE A */}
        <ZoneBox
          icon="🔌"
          zone="Zone A"
          title="Solar Array"
          color="yellow"
          items={[
            `${panelQty} × ${panelW}W panels`,
            `${results.truePVkW.toFixed(1)} kWp total`,
            'DC combiner & surge',
            'protection on roof',
          ]} />

        <FlowArrow />

        {/* ZONE B */}
        <ZoneBox
          icon="⚡"
          zone="Zone B"
          title="Power Plant"
          color="blue"
          items={[
            `${inverterQty} × ${results.totalInverterKW / inverterQty} kW inverter`,
            `${batteryQty} × ${results.trueBattKWh / batteryQty} kWh battery`,
            `${results.trueBattKWh} kWh total storage`,
            tierLabel,
          ]} />

        <FlowArrow />

        {/* ZONE C */}
        <ZoneBox
          icon="🏠"
          zone="Zone C"
          title="Distribution"
          color="green"
          items={[
            'AC breaker board',
            'Smart load timers',
            `${(eng.totalRunningWatts / 1000).toFixed(1)} kW to your loads`,
            'Safe & protected',
          ]} />

      </div>

      {/* Key stats row */}
      <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-white/10">
        {[
          { label: 'Daily generation',  value: `~${(results.truePVkW * eng.peakSunHours * 0.8).toFixed(0)} kWh`,  note: 'at 80% yield' },
          { label: 'Storage capacity',  value: `${results.trueBattKWh} kWh`,  note: `${eng.backupDays} day${eng.backupDays !== 1 ? 's' : ''} backup` },
          { label: 'Running capacity',  value: `${(eng.totalRunningWatts / 1000).toFixed(1)} kW`,  note: 'all loads on' },
        ].map(s => (
          <div key={s.label} className="text-center">
            <div className="text-base font-black text-white font-mono">{s.value}</div>
            <div className="text-xs text-blue-300 font-semibold">{s.label}</div>
            <div className="text-xs text-gray-500">{s.note}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
