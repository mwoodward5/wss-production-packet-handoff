import { createFileRoute, notFound } from "@tanstack/react-router";
import { pagesByPath } from "@/data/seoPages";
import { seoHeadForPage } from "@/lib/seo-head";
import { AuthorityPage } from "@/components/site/AuthorityPage";

export const Route = createFileRoute("/guides/$slug")({
  loader: ({ params }) => {
    const page = pagesByPath.get(`/guides/${params.slug}`);
    if (!page) throw notFound();
    return { page };
  },
  head: ({ loaderData }) => (loaderData ? seoHeadForPage(loaderData.page) : {}),
  component: GuidePage,
});

function GuidePage() {
  const { page } = Route.useLoaderData();
  return <AuthorityPage page={page} />;
}
