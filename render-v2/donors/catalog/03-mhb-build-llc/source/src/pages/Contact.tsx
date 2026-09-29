import { useState } from "react";
import { z } from "zod";
import { Phone, Mail, MapPin, Send } from "lucide-react";
import { Layout } from "@/components/site/Layout";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CallToAction } from "@/components/site/CallToAction";
import { toast } from "sonner";
import { client, pageCopy } from "@/lib/bridge";
import { business, services } from "@/lib/business";
import { breadcrumb, localBusinessSchema } from "@/lib/schema";

const schema = z.object({
  name: z.string().trim().min(1, "Please add your name").max(100),
  phone: z.string().trim().min(7, "Please add a phone number we can reach").max(40),
  email: z.string().trim().email("Please use a valid email").max(200).or(z.literal("")),
  location: z.string().trim().max(160).optional(),
  service: z.string().trim().max(140).optional(),
  timeline: z.string().trim().max(80).optional(),
  message: z.string().trim().max(2000).optional(),
});

const timelineOptions = ["As soon as possible", "Within 1 month", "1–3 months", "3–6 months", "Just planning"];

const Contact = () => {
  const [handoffAttempted, setHandoffAttempted] = useState(false);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!business.email) {
      toast.info(`Please call ${business.phone} to discuss your project.`);
      return;
    }
    const data = new FormData(e.currentTarget);
    const parsed = schema.safeParse(Object.fromEntries(data.entries()));
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || "Please review the form");
      return;
    }
    const v = parsed.data;
    const subject = `Estimate request — ${v.service || "General"} — ${v.name}`;
    const body = [
      `Name: ${v.name}`,
      `Phone: ${v.phone}`,
      v.email ? `Email: ${v.email}` : "",
      v.location ? `Project location: ${v.location}` : "",
      v.service ? `Service: ${v.service}` : "",
      v.timeline ? `Timeline: ${v.timeline}` : "",
      "",
      v.message || "",
    ].filter(Boolean).join("\n");

    const mailto = `mailto:${business.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
    setHandoffAttempted(true);
    toast.info("Email handoff requested. Send the message in your email app to complete the request.");
  };

  return (
    <Layout>
      <SEO
        title={`Contact & Estimates | ${business.name} — ${business.city}, ${business.state}`}
        description={`Contact ${business.name} in ${business.city}, ${business.state}. Call ${business.phone}.`}
        path="/contact"
        schema={[localBusinessSchema, breadcrumb([{name:"Home",path:"/"},{name:"Contact",path:"/contact"}])]}
      />

      <section className="bg-gradient-canvas">
        <div className="container-tight pt-20 pb-12 md:pt-28 md:pb-16">
          <p className="eyebrow"><Send className="h-3.5 w-3.5" /> Request an estimate</p>
          <h1 className="mt-3 font-display text-5xl md:text-6xl max-w-3xl leading-[1.05]">Tell us about your project.</h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
            {pageCopy("contact")} Call <a href={business.phoneHref} className="text-foreground font-semibold">{business.phone}</a>.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container-tight grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-3xl border bg-card p-8 md:p-10 shadow-card">
            {handoffAttempted && (
              <div className="py-12 text-center" role="status">
                <div className="mx-auto h-16 w-16 rounded-full bg-accent-soft grid place-items-center mb-6">
                  <Mail className="h-8 w-8 text-accent" />
                </div>
                <h2 className="font-display text-3xl">Finish in your email app.</h2>
                <p className="mt-3 text-muted-foreground max-w-md mx-auto">
                  This website has not sent your request. Send the prepared message in your email app, or call <a href={business.phoneHref} className="text-foreground font-semibold">{business.phone}</a>.
                </p>
              </div>
            )}
              <form onSubmit={onSubmit} className="grid gap-5" noValidate>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="name">Full name *</Label>
                    <Input id="name" name="name" required maxLength={100} className="mt-2" />
                  </div>
                  <div>
                    <Label htmlFor="phone">Phone *</Label>
                    <Input id="phone" name="phone" type="tel" required maxLength={40} className="mt-2" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" maxLength={200} className="mt-2" />
                </div>
                <div>
                  <Label htmlFor="location">Project location</Label>
                  <Input id="location" name="location" placeholder="City, area, or address" maxLength={160} className="mt-2" />
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="service">Service needed</Label>
                    <Select name="service">
                      <SelectTrigger id="service" className="mt-2"><SelectValue placeholder="Choose a service" /></SelectTrigger>
                      <SelectContent>
                        {services.map(s => <SelectItem key={s.slug} value={s.name}>{s.name}</SelectItem>)}
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="timeline">Timeline</Label>
                    <Select name="timeline">
                      <SelectTrigger id="timeline" className="mt-2"><SelectValue placeholder="When are you hoping to start?" /></SelectTrigger>
                      <SelectContent>
                        {timelineOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label htmlFor="message">Project details</Label>
                  <Textarea id="message" name="message" rows={5} placeholder="Scope, materials you have in mind, anything we should know…" maxLength={2000} className="mt-2" />
                </div>
                <Button type="submit" disabled={!business.email} size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-brass rounded-full">
                  Open email draft
                </Button>
                <p className="text-xs text-muted-foreground">
                  {business.email ? `This form opens an email draft addressed to ${business.email}. You must send it from your email app.` : `Please call ${business.phone} to discuss your project.`}
                </p>
              </form>
          </div>

          <aside className="space-y-5">
            <div className="rounded-2xl border bg-card p-7 shadow-card">
              <h3 className="font-display text-xl mb-4">Reach us directly</h3>
              <ul className="space-y-4 text-sm">
                <li className="flex gap-3"><Phone className="h-5 w-5 text-accent mt-0.5 shrink-0" /><div><p className="font-semibold">Phone</p><a href={business.phoneHref} className="text-muted-foreground hover:text-accent">{business.phone}</a></div></li>
                {business.email && <li className="flex gap-3"><Mail className="h-5 w-5 text-accent mt-0.5 shrink-0" /><div><p className="font-semibold">Email</p><a href={business.emailHref} className="text-muted-foreground hover:text-accent break-all">{business.email}</a></div></li>}
                <li className="flex gap-3"><MapPin className="h-5 w-5 text-accent mt-0.5 shrink-0" /><div><p className="font-semibold">Service area</p><p className="text-muted-foreground">{business.region || `${business.city}, ${business.state}`}</p></div></li>
              </ul>
            </div>
            {client.trust.mapUrl && <div className="rounded-2xl overflow-hidden border shadow-card">
              <a href={client.trust.mapUrl} target="_blank" rel="noopener noreferrer" className="w-full h-72 flex items-center justify-center bg-secondary text-accent">
                <MapPin className="mr-2 h-5 w-5" /> View business map
              </a>
            </div>}

          </aside>
        </div>
      </section>

      <CallToAction />
    </Layout>
  );
};

export default Contact;
