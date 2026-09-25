import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/query';
import { Button, Dialog, Field, Input, Textarea } from '@/components/ui';

export function NewProspectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const empty = { name: '', contactFirstName: '', contactLastName: '', email: '', phone: '', locationLabel: '', categoryLabel: '', websiteUrl: '', note: '' };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (open) {
      setForm(empty);
      setErrors({});
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = useAction((f: typeof form) => api.post<{ id: string }>('/api/prospects', f), {
    success: 'Prospect added',
    invalidate: [['prospects'], ['dashboard']],
    onSuccess: (r) => {
      onOpenChange(false);
      navigate(`/app/prospects/${r.id}`);
    },
    onError: (e: ApiError) => setErrors(e.fields),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New prospect"
      description="Add a business you found yourself. To add businesses from Google Maps, use Discover."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} disabled={!form.name.trim()} onClick={() => create.mutate(form)}>
            Add prospect
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" htmlFor="np-name" error={errors.name} className="sm:col-span-2">
          <Input id="np-name" autoFocus value={form.name} onChange={set('name')} placeholder="Harbour Barbers" />
        </Field>
        <Field label="Contact first name" htmlFor="np-first" optional error={errors.contactFirstName}>
          <Input id="np-first" value={form.contactFirstName} onChange={set('contactFirstName')} />
        </Field>
        <Field label="Contact last name" htmlFor="np-last" optional error={errors.contactLastName}>
          <Input id="np-last" value={form.contactLastName} onChange={set('contactLastName')} />
        </Field>
        <Field label="Email" htmlFor="np-email" optional error={errors.email}>
          <Input id="np-email" type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Phone" htmlFor="np-phone" optional error={errors.phone}>
          <Input id="np-phone" value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label="Category" htmlFor="np-cat" optional>
          <Input id="np-cat" value={form.categoryLabel} onChange={set('categoryLabel')} placeholder="barber" />
        </Field>
        <Field label="Location" htmlFor="np-loc" optional>
          <Input id="np-loc" value={form.locationLabel} onChange={set('locationLabel')} placeholder="Sea Point" />
        </Field>
        <Field label="Website" htmlFor="np-web" optional hint="Leave blank if they don't have one" className="sm:col-span-2">
          <Input id="np-web" value={form.websiteUrl} onChange={set('websiteUrl')} placeholder="https://" />
        </Field>
        <Field label="Note" htmlFor="np-note" optional className="sm:col-span-2">
          <Textarea id="np-note" value={form.note} onChange={set('note')} rows={3} />
        </Field>
      </div>
    </Dialog>
  );
}
