import { createFileRoute, notFound } from "@tanstack/react-router";
import { pagesByPath } from "@/data/seoPages";
import { seoHeadForPage } from "@/lib/seo-head";
import { AuthorityPage } from "@/components/site/AuthorityPage";

export const Route = createFileRoute("/$slug")({
  loader: ({ params }) => {
    const page = pagesByPath.get(`/${params.slug}`);
    if (!page) throw notFound();
    return { page };
  },
  head: ({ loaderData }) => (loaderData ? seoHeadForPage(loaderData.page) : {}),
  component: SlugPage,
});

function SlugPage() {
  const { page } = Route.useLoaderData();
  return <AuthorityPage page={page} />;
}
