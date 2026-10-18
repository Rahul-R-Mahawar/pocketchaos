import { Braces, CircleAlert, LoaderCircle, Plus, WandSparkles } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { fieldErrorsFrom, toApiError } from '../api/errors';
import { HTTP_METHODS, type EndpointDto, type HttpMethod } from '../api/types';
import { useApi } from '../auth/context';
import {
  EMPTY_ENDPOINT_FORM,
  parseMockJson,
  validateEndpointForm,
  type EndpointFormErrors,
  type EndpointFormField,
  type EndpointFormValues,
} from '../lib/endpointForm';
import { inputClass, labelClass, panel, primaryButton, secondaryButton } from './ui/styles';

interface EndpointFormProps {
  projectKey: string;
  onCreated: (endpoint: EndpointDto) => void;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs text-red-300">
      {message}
    </p>
  );
}

export function EndpointForm({ projectKey, onCreated }: EndpointFormProps) {
  const { api } = useApi();
  const [values, setValues] = useState<EndpointFormValues>(EMPTY_ENDPOINT_FORM);
  const [errors, setErrors] = useState<EndpointFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const baseId = useId();
  const id = (field: EndpointFormField) => `${baseId}-${field}`;

  const set = <K extends EndpointFormField>(field: K, value: EndpointFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const errorProps = (field: EndpointFormField) => ({
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? `${id(field)}-error` : undefined,
  });

  function formatJson() {
    const parsed = parseMockJson(values.mockJson);
    if (parsed.ok && parsed.value !== undefined) set('mockJson', JSON.stringify(parsed.value, null, 2));
    else if (!parsed.ok) setErrors((current) => ({ ...current, mockJson: parsed.error }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setCreated(null);
    const result = validateEndpointForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const endpoint = await api.createEndpoint(result.payload);
      onCreated(endpoint);
      setValues({ ...EMPTY_ENDPOINT_FORM, method: values.method });
      setCreated(`${endpoint.method} ${endpoint.path}`);
    } catch (raw) {
      const error = toApiError(raw);
      const serverFields = fieldErrorsFrom(error);
      const mapped: EndpointFormErrors = {};
      for (const [field, message] of Object.entries(serverFields)) {
        const key = field === 'mockResponseJson' ? 'mockJson' : field;
        if (key in EMPTY_ENDPOINT_FORM) mapped[key as EndpointFormField] = message;
      }
      if (Object.keys(mapped).length > 0) setErrors(mapped);
      else setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  const usingTarget = values.targetUrl.trim() !== '';

  return (
    <section aria-labelledby={`${baseId}-title`} className={`${panel} p-5`}>
      <div className="mb-4 flex items-center gap-2">
        <Plus aria-hidden className="size-4 text-emerald-400" />
        <h2 id={`${baseId}-title`} className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          New chaos endpoint
        </h2>
      </div>

      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <div>
            <label htmlFor={id('name')} className={labelClass}>
              Name
            </label>
            <input
              id={id('name')}
              value={values.name}
              onChange={(event) => set('name', event.target.value)}
              placeholder="User profile"
              className={inputClass(Boolean(errors.name))}
              {...errorProps('name')}
            />
            <FieldError id={`${id('name')}-error`} message={errors.name} />
          </div>
          <div>
            <label htmlFor={id('method')} className={labelClass}>
              Method
            </label>
            <select
              id={id('method')}
              value={values.method}
              onChange={(event) => set('method', event.target.value as HttpMethod)}
              className={`${inputClass(Boolean(errors.method))} font-mono`}
            >
              {HTTP_METHODS.map((method) => (
                <option key={method}>{method}</option>
              ))}
            </select>
            <FieldError id={`${id('method')}-error`} message={errors.method} />
          </div>
        </div>

        <div>
          <label htmlFor={id('path')} className={labelClass}>
            Path
          </label>
          <div
            className={`flex overflow-hidden rounded-lg border bg-zinc-950 focus-within:ring-2 ${
              errors.path
                ? 'border-red-500/70 focus-within:ring-red-500/30'
                : 'border-zinc-800 focus-within:border-emerald-500/60 focus-within:ring-emerald-500/20'
            }`}
          >
            <span className="flex items-center border-r border-zinc-800 bg-zinc-900 px-3 font-mono text-xs text-zinc-500">
              /proxy/{projectKey}
            </span>
            <input
              id={id('path')}
              value={values.path}
              onChange={(event) => set('path', event.target.value)}
              placeholder="/users/profile"
              className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
              {...errorProps('path')}
            />
          </div>
          <FieldError id={`${id('path')}-error`} message={errors.path} />
        </div>

        <div>
          <label htmlFor={id('targetUrl')} className={labelClass}>
            Target URL <span className="normal-case tracking-normal text-zinc-600">(optional: forward to a real API)</span>
          </label>
          <input
            id={id('targetUrl')}
            value={values.targetUrl}
            onChange={(event) => set('targetUrl', event.target.value)}
            placeholder="https://api.example.com/users/1"
            inputMode="url"
            className={`${inputClass(Boolean(errors.targetUrl))} font-mono`}
            {...errorProps('targetUrl')}
          />
          <FieldError id={`${id('targetUrl')}-error`} message={errors.targetUrl} />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor={id('mockJson')} className={`${labelClass} mb-0 flex items-center gap-1.5`}>
              <Braces aria-hidden className="size-3.5" />
              Mock response JSON
            </label>
            <button type="button" onClick={formatJson} className={`${secondaryButton} px-2 py-1 text-xs`}>
              <WandSparkles aria-hidden className="size-3.5" />
              Format
            </button>
          </div>
          <textarea
            id={id('mockJson')}
            value={values.mockJson}
            onChange={(event) => set('mockJson', event.target.value)}
            rows={7}
            spellCheck={false}
            className={`${inputClass(Boolean(errors.mockJson))} resize-y font-mono text-xs leading-relaxed ${
              usingTarget ? 'opacity-60' : ''
            }`}
            {...errorProps('mockJson')}
          />
          <FieldError id={`${id('mockJson')}-error`} message={errors.mockJson} />
          {usingTarget && !errors.mockJson && (
            <p className="mt-1 text-xs text-zinc-500">A target URL is set, so requests are forwarded and this mock is not served.</p>
          )}
        </div>

        {formError && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {formError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={submitting} className={primaryButton}>
            {submitting ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Plus aria-hidden className="size-4" />}
            Create endpoint
          </button>
          {created && (
            <p role="status" className="text-sm text-emerald-300">
              Created <span className="font-mono">{created}</span>
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
