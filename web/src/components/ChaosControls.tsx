import { Percent, ShieldAlert, Timer } from 'lucide-react';
import { useId } from 'react';
import { DEFAULT_FAULT_STATUS, FAULT_STATUS_OPTIONS, MAX_DELAY_MS, type ChaosConfig } from '../api/types';
import type { ChangeMode } from '../hooks/useChaosSync';
import { formatMs } from '../lib/format';
import { Toggle } from './ui/Toggle';

interface ChaosControlsProps {
  config: ChaosConfig;
  onChange: (patch: Partial<ChaosConfig>, mode?: ChangeMode) => void;
}

const STATUS_LABELS: Record<number, string> = {
  401: 'Unauthorized',
  403: 'Forbidden',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

export function ChaosControls({ config, onChange }: ChaosControlsProps) {
  const ids = { delay: useId(), failure: useId(), status: useId() };
  const faultStatus = config.overrideStatusCode ?? DEFAULT_FAULT_STATUS;
  // A status set through the API that is not one of the presets still shows correctly.
  const statusOptions = (FAULT_STATUS_OPTIONS as readonly number[]).includes(faultStatus)
    ? [...FAULT_STATUS_OPTIONS]
    : [...FAULT_STATUS_OPTIONS, faultStatus];

  return (
    <div className="space-y-4">
      <Toggle
        label="Chaos enabled"
        description={config.enabled ? 'Rules below apply to every proxied request' : 'Off: requests pass through untouched'}
        checked={config.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />

      <fieldset
        className={`space-y-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4 transition-opacity ${
          config.enabled ? '' : 'opacity-50'
        }`}
      >
        <legend className="sr-only">Chaos rules</legend>

        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <label htmlFor={ids.delay} className="flex items-center gap-1.5 font-medium text-zinc-300">
              <Timer aria-hidden className="size-4 text-sky-400" />
              Latency
            </label>
            <span className="font-mono text-sky-300">{formatMs(config.delayMs)}</span>
          </div>
          <input
            id={ids.delay}
            type="range"
            min={0}
            max={MAX_DELAY_MS}
            step={100}
            value={config.delayMs}
            onChange={(event) => onChange({ delayMs: Math.round(Number(event.target.value)) }, 'debounced')}
            aria-valuetext={formatMs(config.delayMs)}
            className="w-full accent-sky-400"
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <label htmlFor={ids.failure} className="flex items-center gap-1.5 font-medium text-zinc-300">
              <Percent aria-hidden className="size-4 text-red-400" />
              Failure rate
            </label>
            <span className="font-mono text-red-300">{config.failureRate}%</span>
          </div>
          <input
            id={ids.failure}
            type="range"
            min={0}
            max={100}
            step={1}
            value={config.failureRate}
            onChange={(event) => onChange({ failureRate: Number(event.target.value) }, 'debounced')}
            aria-valuetext={`${config.failureRate} percent`}
            className="w-full accent-red-400"
          />
        </div>

        <div>
          <label htmlFor={ids.status} className="mb-1 flex items-center gap-1.5 text-sm font-medium text-zinc-300">
            <ShieldAlert aria-hidden className="size-4 text-amber-400" />
            Fault status code
          </label>
          <select
            id={ids.status}
            value={faultStatus}
            onChange={(event) => onChange({ overrideStatusCode: Number(event.target.value) })}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status} {STATUS_LABELS[status] ?? ''}
                {status === DEFAULT_FAULT_STATUS && config.overrideStatusCode === null ? ' (default)' : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">
            {config.failureRate === 0
              ? 'Only used for injected faults: raise the failure rate above 0% to see it.'
              : `Injected faults return ${faultStatus} with a {"chaosFault": true} body.`}
          </p>
        </div>

        <Toggle
          label="Corrupt JSON payload"
          description="Randomly nulls, retypes or drops fields in successful JSON bodies"
          tone="amber"
          checked={config.corruptJson}
          onChange={(corruptJson) => onChange({ corruptJson })}
        />
      </fieldset>
    </div>
  );
}
