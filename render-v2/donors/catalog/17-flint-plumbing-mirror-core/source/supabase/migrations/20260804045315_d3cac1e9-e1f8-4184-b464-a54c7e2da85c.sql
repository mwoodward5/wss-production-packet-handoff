CREATE TABLE public.reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_key text NOT NULL,
  external_id text NOT NULL,
  author text NOT NULL,
  avatar_url text,
  rating int NOT NULL DEFAULT 5,
  body text NOT NULL,
  platform text,
  service_tag text,
  location text,
  source_url text,
  published_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_key, external_id)
);

CREATE TABLE public.ratings_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_key text NOT NULL,
  platform text NOT NULL,
  rating_value numeric NOT NULL,
  review_count int NOT NULL,
  best_rating numeric NOT NULL DEFAULT 5,
  profile_url text,
  verified_at date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_key, platform)
);

CREATE TABLE public.refresh_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_key text NOT NULL,
  source text NOT NULL,
  status text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

GRANT SELECT ON public.reviews TO anon, authenticated;
GRANT ALL ON public.reviews TO service_role;
GRANT SELECT ON public.ratings_snapshots TO anon, authenticated;
GRANT ALL ON public.ratings_snapshots TO service_role;
GRANT ALL ON public.refresh_runs TO service_role;

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refresh_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read reviews" ON public.reviews FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public can read rating snapshots" ON public.ratings_snapshots FOR SELECT TO anon, authenticated USING (true);

CREATE INDEX reviews_site_key_idx ON public.reviews (site_key, published_at DESC NULLS LAST);