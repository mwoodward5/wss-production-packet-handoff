import * as React from "react";
import type { WidgetId } from "../trust.config";

import { ReviewMarquee } from "../components/ReviewMarquee";
import { ReviewSpotlight } from "../components/ReviewSpotlight";
import { ReviewWall } from "../components/ReviewWall";
import { RatingBadgeCluster } from "../components/RatingBadgeCluster";
import { StarSummaryBar } from "../components/StarSummaryBar";
import { VideoTestimonialStrip } from "../components/VideoTestimonialStrip";
import { RecentActivityToasts } from "../components/RecentActivityToasts";
import { LivePresenceTicker } from "../components/LivePresenceTicker";
import { CounterStatBand } from "../components/CounterStatBand";
import { SocialFollowerBar } from "../components/SocialFollowerBar";
import { InstagramGridEmbed } from "../components/InstagramGridEmbed";
import { UGCCarousel } from "../components/UGCCarousel";
import { HashtagFeedRail } from "../components/HashtagFeedRail";
import { TrustBadgeRail } from "../components/TrustBadgeRail";
import { PressLogoStrip } from "../components/PressLogoStrip";
import { AwardsTimeline } from "../components/AwardsTimeline";
import { GuaranteePanel } from "../components/GuaranteePanel";
import { CredentialModal } from "../components/CredentialModal";
import { LicenseVerifyBadge } from "../components/LicenseVerifyBadge";
import { InsuranceProofPanel } from "../components/InsuranceProofPanel";
import { BeforeAfterSlider } from "../components/BeforeAfterSlider";
import { PortfolioLightbox } from "../components/PortfolioLightbox";
import { CapacityMeter } from "../components/CapacityMeter";
import { BookNowSticky } from "../components/BookNowSticky";
import { OpenNowStatus } from "../components/OpenNowStatus";
import { WaitTimeBadge } from "../components/WaitTimeBadge";
import { EmergencyCTABand } from "../components/EmergencyCTABand";
import { ResponseTimePromise } from "../components/ResponseTimePromise";
import { ServiceAreaBanner } from "../components/ServiceAreaBanner";
import { MultiLocationMap } from "../components/MultiLocationMap";
import { ServiceMenuGrid } from "../components/ServiceMenuGrid";
import { MenuSchemaBlock } from "../components/MenuSchemaBlock";
import { SeoProofBlock } from "../components/SeoProofBlock";
import { VoiceAnswerBlock } from "../components/VoiceAnswerBlock";
import { SpeakableSchema } from "../components/SpeakableSchema";
import { ProofStickyBar } from "../components/ProofStickyBar";
import { ProofInlineCallout } from "../components/ProofInlineCallout";
import { ExitProofModal } from "../components/ExitProofModal";

export interface WidgetMeta {
  id: WidgetId;
  title: string;
  Component: React.ComponentType;
  /** section-level widgets get a heading + padding; overlays render bare */
  overlay?: boolean;
}

const M = (id: WidgetId, title: string, Component: React.ComponentType<never>, overlay = false): WidgetMeta =>
  ({ id, title, Component: Component as unknown as React.ComponentType, overlay });

export const WIDGET_REGISTRY: Record<WidgetId, WidgetMeta> = {
  ReviewMarquee: M("ReviewMarquee", "What customers say", ReviewMarquee as never),
  ReviewSpotlight: M("ReviewSpotlight", "In their words", ReviewSpotlight as never),
  ReviewWall: M("ReviewWall", "Every review", ReviewWall as never),
  RatingBadgeCluster: M("RatingBadgeCluster", "Rated across platforms", RatingBadgeCluster as never),
  StarSummaryBar: M("StarSummaryBar", "", StarSummaryBar as never),
  VideoTestimonialStrip: M("VideoTestimonialStrip", "Customer stories", VideoTestimonialStrip as never),
  RecentActivityToasts: M("RecentActivityToasts", "", RecentActivityToasts as never, true),
  LivePresenceTicker: M("LivePresenceTicker", "", LivePresenceTicker as never),
  CounterStatBand: M("CounterStatBand", "By the numbers", CounterStatBand as never),
  SocialFollowerBar: M("SocialFollowerBar", "Follow along", SocialFollowerBar as never),
  InstagramGridEmbed: M("InstagramGridEmbed", "Latest work", InstagramGridEmbed as never),
  UGCCarousel: M("UGCCarousel", "From our customers", UGCCarousel as never),
  HashtagFeedRail: M("HashtagFeedRail", "Tagged with us", HashtagFeedRail as never),
  TrustBadgeRail: M("TrustBadgeRail", "", TrustBadgeRail as never),
  PressLogoStrip: M("PressLogoStrip", "", PressLogoStrip as never),
  AwardsTimeline: M("AwardsTimeline", "Recognition", AwardsTimeline as never),
  GuaranteePanel: M("GuaranteePanel", "Our promise", GuaranteePanel as never),
  CredentialModal: M("CredentialModal", "", CredentialModal as never),
  LicenseVerifyBadge: M("LicenseVerifyBadge", "", LicenseVerifyBadge as never),
  InsuranceProofPanel: M("InsuranceProofPanel", "Licensed, bonded, insured", InsuranceProofPanel as never),
  BeforeAfterSlider: M("BeforeAfterSlider", "Before and after", BeforeAfterSlider as never),
  PortfolioLightbox: M("PortfolioLightbox", "Our work", PortfolioLightbox as never),
  CapacityMeter: M("CapacityMeter", "Availability", CapacityMeter as never),
  BookNowSticky: M("BookNowSticky", "", BookNowSticky as never, true),
  OpenNowStatus: M("OpenNowStatus", "", OpenNowStatus as never),
  WaitTimeBadge: M("WaitTimeBadge", "", WaitTimeBadge as never),
  EmergencyCTABand: M("EmergencyCTABand", "", EmergencyCTABand as never),
  ResponseTimePromise: M("ResponseTimePromise", "", ResponseTimePromise as never),
  ServiceAreaBanner: M("ServiceAreaBanner", "", ServiceAreaBanner as never),
  MultiLocationMap: M("MultiLocationMap", "Find us", MultiLocationMap as never),
  ServiceMenuGrid: M("ServiceMenuGrid", "Services", ServiceMenuGrid as never),
  MenuSchemaBlock: M("MenuSchemaBlock", "Pricing", MenuSchemaBlock as never),
  SeoProofBlock: M("SeoProofBlock", "", SeoProofBlock as never),
  VoiceAnswerBlock: M("VoiceAnswerBlock", "Quick answers", VoiceAnswerBlock as never),
  SpeakableSchema: M("SpeakableSchema", "", SpeakableSchema as never, true),
  ProofStickyBar: M("ProofStickyBar", "", ProofStickyBar as never, true),
  ProofInlineCallout: M("ProofInlineCallout", "", ProofInlineCallout as never),
  ExitProofModal: M("ExitProofModal", "", ExitProofModal as never, true),
};
