"use client";

interface StatusSelectFormProps {
  action: (formData: FormData) => void | Promise<void>;
  id: string;
  label: string;
  defaultValue: string;
  options: readonly string[];
}

export function StatusSelectForm({ action, id, label, defaultValue, options }: StatusSelectFormProps) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <select
        name="status"
        defaultValue={defaultValue}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        aria-label={label}
        className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-800"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replace("_", " ")}
          </option>
        ))}
      </select>
    </form>
  );
}
