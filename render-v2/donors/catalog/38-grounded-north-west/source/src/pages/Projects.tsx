import { Seo } from "@/components/site/Seo";
import { PageHero } from "@/components/site/PageHero";
import { ContactClose } from "@/components/site/ContactClose";
import { useClient, useSitePlan, galleryMedia } from "@/lib/wss";

const Projects = () => {
const c=useClient(), plan=useSitePlan(); const projects=galleryMedia(c).map(m=>({src:m.path,title:"",caption:""}));
return (
  <>
    <Seo title={"Projects | " + c.identity.businessName} description={plan.content.gallery || ""} path="/projects" />
    <PageHero eyebrow="Projects" title={<>{c.identity.businessName} <span className="copper-text italic">gallery</span></>} intro={plan.content.gallery || ""} imageAlt="" />
    <section className="container py-16">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {projects.map(p => (
          <figure key={p.src} className="group rounded-2xl overflow-hidden border border-border bg-card shadow-sm">
            <div className="aspect-[4/3] overflow-hidden">
              <img src={p.src} alt={p.title} loading="lazy" width={1200} height={900} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500" />
            </div>
            {(p.title || p.caption) && <figcaption className="p-4">
              <div className="font-display text-lg">{p.title}</div>
              <div className="text-sm text-muted-foreground">{p.caption}</div>
            </figcaption>}
          </figure>
        ))}
      </div>
    </section>
    <ContactClose />
  </>
);
};

export default Projects;
