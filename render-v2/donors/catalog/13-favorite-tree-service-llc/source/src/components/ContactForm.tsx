import { useState } from "react";
import { client } from "@/lib/wss-bridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

import { Star, CheckCircle2, Loader2 } from "lucide-react";
import { REVIEW_URL } from "@/lib/business";

const SERVICES = client.services.map(s => s.name);
export function ContactForm() {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!client.identity.email) return;
    const fd = new FormData(e.currentTarget);
    const body = ['name','phone','email','service','message'].map(k => k+': '+String(fd.get(k) || '')).join('\n');
    window.location.href = 'mailto:' + client.identity.email + '?subject=' + encodeURIComponent('Project inquiry') + '&body=' + encodeURIComponent(body);
  }
  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-elegant sm:p-8">
      {/* honeypot */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Name *</Label>
          <Input id="name" name="name" required maxLength={100} autoComplete="name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone *</Label>
          <Input id="phone" name="phone" type="tel" required maxLength={30} autoComplete="tel" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" maxLength={255} autoComplete="email" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="service">Service Needed *</Label>
        <select
          id="service"
          name="service"
          required
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Select a service…</option>
          {SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="message">Tell us about your project *</Label>
        <Textarea id="message" name="message" required minLength={5} maxLength={2000} rows={5} defaultValue={typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get("scope") || ""} placeholder="Number of trees, location, urgency, anything else helpful…" />
      </div>

      <Button type="submit" disabled={!client.identity.email} className="w-full bg-cta-gradient text-accent-foreground shadow-amber hover:opacity-95">
        Open email draft
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Nothing is sent by this site. Review and send from your email app, or call <a href={client.identity.phoneTel} className="font-semibold text-primary">{client.identity.phoneDisplay}</a>.
      </p>
    </form>
  );
}
