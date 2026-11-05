import React from 'react';
import { ModelCatalog, modelName } from '../services/models';

interface ModelSelectProps {
  catalog: ModelCatalog;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  /** Label for the empty option, e.g. "Project model (gpt-5)". */
  inheritLabel: string;
  className?: string;
  disabled?: boolean;
}

/** Models grouped by provider. An empty value means "inherit". */
export const ModelSelect: React.FC<ModelSelectProps> = ({ catalog, value, onChange, inheritLabel, className, disabled }) => {
  const known = !value || catalog.models.some((m) => m.id === value);
  return (
    <select
      value={value || ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      className={className}
    >
      <option value="">{inheritLabel}</option>
      {catalog.providers.map((p) => (
        <optgroup key={p.id} label={p.label}>
          {catalog.models
            .filter((m) => m.provider === p.id)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.model}
              </option>
            ))}
        </optgroup>
      ))}
      {!known && <option value={value!}>{modelName(value)} (unavailable)</option>}
    </select>
  );
};
