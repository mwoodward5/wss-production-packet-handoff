import GrainOverlay from "@/components/luxury/GrainOverlay";
import CustomCursor from "@/components/luxury/CustomCursor";
import Preloader from "@/components/luxury/Preloader";
import ScrollProgress from "@/components/luxury/ScrollProgress";
import Navbar from "@/components/luxury/Navbar";
import Hero from "@/components/luxury/Hero";
import CredibilityStrip from "@/components/luxury/CredibilityStrip";
import AboutBrand from "@/components/luxury/AboutBrand";
import ClientTypes from "@/components/luxury/ClientTypes";
import FeaturedLifestyle from "@/components/luxury/FeaturedLifestyle";
import Collections from "@/components/luxury/Collections";
import MarketExpertise from "@/components/luxury/MarketExpertise";
import TheDifference from "@/components/luxury/TheDifference";
import Testimonials from "@/components/luxury/Testimonials";
import FAQ from "@/components/luxury/FAQ";
import FinalCTA from "@/components/luxury/FinalCTA";
import Footer from "@/components/luxury/Footer";

// The source design wrapped the page in a Lenis smooth-scroll controller;
// this port relies on the stylesheet's native `scroll-behavior: smooth`
// (with the reduced-motion override) instead — no scroll hijacking, one
// less dependency, identical anchor behavior.
const Index = () => {
  return (
    <div className="min-h-screen">
      <Preloader />
      <CustomCursor />
      <ScrollProgress />
      <GrainOverlay />
      <Navbar />
      <Hero />
      <CredibilityStrip />
      <AboutBrand />
      <ClientTypes />
      <FeaturedLifestyle />
      <Collections />
      <MarketExpertise />
      <TheDifference />
      <Testimonials />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
};

export default Index;
