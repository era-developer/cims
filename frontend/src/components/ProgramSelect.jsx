import React from 'react';

export const OTHER_PROGRAM = '__other__';

// Resolves what the parent should actually submit for a "name"-mode
// ProgramSelect: the picked program's name, or the free-text "Other" value.
export function resolveProgramName(value, otherValue) {
  return value === OTHER_PROGRAM ? String(otherValue || '').trim() : value;
}

// Dropdown of managed Programs (created on the My Center page), with an
// "Other" option that reveals a free-text field for one-off/exceptional
// cases that don't warrant creating a full Program record.
//
// mode="name": <select> value/onChange work with the program's name string
//   -- drop-in for existing free-text "Program Name" fields (Invoice Entry,
//   Add Component, Edit Invoice); no backend change needed there.
// mode="id": <select> value/onChange work with the program's numeric id --
//   used where the backend needs a real link (e.g. marking a unit damaged).
export default function ProgramSelect({
  programs, mode = 'name', value, otherValue, onChange, onOtherChange,
  label = 'Program', required, placeholder = 'Describe the program / reason...',
}) {
  const isOther = value === OTHER_PROGRAM;
  // Completed programs shouldn't be pickable for new procurement/damage/
  // transfer activity -- but a record already pointing at one (e.g. an
  // invoice entered before the program wrapped up) must still show it here,
  // or the field looks silently blank/lost every time you reopen it.
  const selectable = programs.filter(p => p.status !== 'completed'
    || (mode === 'id' ? String(p.id) === String(value) : p.name === value));
  return (
    <div style={styles.wrap}>
      {label && <label style={styles.label}>{label}{required ? ' *' : ''}</label>}
      <select style={styles.select} value={value || ''} required={required}
        onChange={e => onChange(e.target.value)}>
        <option value="">Select...</option>
        {selectable.map(p => (
          <option key={p.id} value={mode === 'id' ? p.id : p.name}>{p.name}</option>
        ))}
        <option value={OTHER_PROGRAM}>Other (specify)...</option>
      </select>
      {isOther && (
        <input style={styles.select} placeholder={placeholder} value={otherValue || ''}
          onChange={e => onOtherChange(e.target.value)} />
      )}
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '12px', fontWeight: 700, color: '#475569' },
  select: { padding: '10px 12px', border: '1.5px solid #dbe3f0', borderRadius: '10px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none', background: '#fff' },
};
