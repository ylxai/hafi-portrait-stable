'use client';

import Header from "@/components/header";
import HeroSection from "@/components/hero-section";
import EventsSection from "@/components/events-section";
import GallerySection from "@/components/gallery-section";
import PricingSection from "@/components/pricing-section";
import ContactSection from "@/components/contact-section";
import Footer from "@/components/footer";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-wedding-ivory">
      <Header />
      <main className="relative">
        <HeroSection />
        <EventsSection />
        <GallerySection />  
        <PricingSection />
        <ContactSection />
      </main>
      <Footer />
    </div>
  );
} 