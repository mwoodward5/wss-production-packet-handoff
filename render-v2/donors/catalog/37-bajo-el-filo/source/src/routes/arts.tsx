import {pageMeta} from '@/wss/bridge';
import { createFileRoute } from "@tanstack/react-router";
import { ArtAtlas } from "@/components/ArtAtlas";
import { PageHero, ClosingCTA } from "@/components/PageChrome";

export const Route = createFileRoute("/arts")({
  head:()=>pageMeta("Arts"),
  component: ArtsPage,
});

function ArtsPage() {
  return (
    <>
      <PageHero
        eyebrow="The atlas"
        title={<>The <span className="italic text-steel">arts.</span></>}
        sub="Explore the training programs."
      />
      <ArtAtlas />
      <ClosingCTA />
    </>
  );
}
