import { Nav } from '@/components/site/Nav';
import { Footer } from '@/components/site/Footer';
import { Hero } from '@/components/site/Hero';
import { Modes } from '@/components/site/Modes';
import { MotionInit } from '@/components/site/MotionInit';
import {
  Band,
  Compare,
  Cta,
  Faq,
  Features,
  Manifesto,
  Numbers,
  Pipeline,
  SectionHead,
  Stats,
} from '@/components/site/Pieces';

/**
 * The landing page.
 *
 * Every section here corresponds to something the product does. The page arrived with a
 * "bring your own key" section offering to store a Claude key encrypted per user, and a
 * demo-workspace button; both were removed rather than reworded, because this codebase
 * has one server-side key in `.env` and no demo endpoint, and a marketing page is a
 * claim you have to be able to defend.
 *
 * The compliance figures are not written here either — they are read from the shipped
 * rule pack through `lib/site/rules.ts`, so the count and version on the page cannot
 * drift from the pack the agents actually inject.
 */
export default function Home() {
  return (
    <>
      <Nav />

      <main id="main">
        <Hero />
        <Manifesto />

        <section className="s" id="modes">
          <div className="wrap">
            <SectionHead
              eyebrow="One platform. Three guarantees."
              lines={[['Specs you can audit,'], ['not just read.']]}
              sub="Pick a guarantee to see it in action. Each one is a feature of the product, not a slide."
            />
            <Modes />
          </div>
        </section>

        <Band />
        <Pipeline />
        <Numbers />
        <Features />
        <Compare />
        <Stats />
        <Faq />
        <Cta />
      </main>

      <Footer />
      <MotionInit />
    </>
  );
}
