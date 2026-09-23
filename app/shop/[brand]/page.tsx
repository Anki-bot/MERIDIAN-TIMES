"use client";

import { useState, use } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import Image from "next/image";

const INVENTORY_DATABASE: Record<string, any[]> = {
  "armani-exchange": [
    { id: "ax-01", name: "A|X Stainless Steel Chronograph", reference: "AX-01", price: "$210", description: "A bold, industrial-inspired chronograph featuring a brushed steel case and a multi-layered dial for a striking modern aesthetic.", cloudinaryId: "ax1", specs: { case: "44mm Steel", dial: "Dark Grey", movement: "Quartz Chronograph", waterResistance: "50m" } },
    { id: "ax-02", name: "A|X Minimalist Two-Tone", reference: "AX-02", price: "$180", description: "Sleek and versatile. This piece strips away the unnecessary, leaving a clean, two-tone presentation perfect for everyday wear.", cloudinaryId: "ax2", specs: { case: "42mm Steel/Gold", dial: "Sunray Silver", movement: "Quartz", waterResistance: "50m" } },
    { id: "ax-03", name: "A|X Stealth Black Edition", reference: "AX-03", price: "$195", description: "An all-black silhouette with contrasting matte and polished finishes, offering a tactical yet refined presence on the wrist.", cloudinaryId: "ax3", specs: { case: "44mm Black IP", dial: "Matte Black", movement: "Quartz", waterResistance: "50m" } },
    { id: "ax-04", name: "A|X Classic Dress Watch", reference: "AX-04", price: "$160", description: "Elegance redefined. A slim profile and refined dial markers make this the perfect companion for formal and smart-casual attire.", cloudinaryId: "ax4", specs: { case: "40mm Steel", dial: "White", movement: "Quartz", waterResistance: "30m" } },
    { id: "ax-05", name: "A|X Sport Silicone", reference: "AX-05", price: "$150", description: "Built for movement. Features a durable, comfortable silicone strap integrated perfectly into a lightweight, dynamic case.", cloudinaryId: "ax5", specs: { case: "43mm Composite", dial: "Black/Red", movement: "Quartz", waterResistance: "100m" } },
    { id: "ax-06", name: "A|X Modern Aviator", reference: "AX-06", price: "$230", description: "Taking cues from classic flight instruments, featuring oversized numerals, high-contrast hands, and a complex textured dial.", cloudinaryId: "ax6", specs: { case: "45mm Steel", dial: "Blue", movement: "Quartz Chronograph", waterResistance: "50m" } },
    { id: "ax-07", name: "A|X Mesh Bracelet Edition", reference: "AX-07", price: "$185", description: "A fluid stainless steel mesh bracelet flows seamlessly into a minimalist dial, combining retro appeal with contemporary design.", cloudinaryId: "ax7", specs: { case: "42mm Steel", dial: "Midnight Blue", movement: "Quartz", waterResistance: "50m" } },
    { id: "ax-08", name: "A|X Signature Gold", reference: "AX-08", price: "$240", description: "Unapologetic luxury. A brilliant gold-tone finish from case to clasp, anchored by the iconic Armani Exchange horizontal dial split.", cloudinaryId: "ax8", specs: { case: "44mm Gold-Tone", dial: "Emerald Green", movement: "Quartz Chronograph", waterResistance: "50m" } }
  ],
  "audemars-piguet": [
    { id: "ap-01", name: "Royal Oak Selfwinding", reference: "15500ST", price: "$25,300", description: "The definitive luxury sports watch. Featuring the iconic octagonal bezel, exposed screws, and a mesmerizing Grande Tapisserie dial.", cloudinaryId: "ap1", specs: { case: "41mm Steel", dial: "Blue Tapisserie", movement: "Automatic Calibre 4302", waterResistance: "50m" } },
    { id: "ap-02", name: "Royal Oak Chronograph", reference: "26331ST", price: "$32,000", description: "Masterful horology meets dynamic design. This chronograph elevates the Royal Oak architecture with precise timing capabilities.", cloudinaryId: "ap2", specs: { case: "41mm Steel", dial: "Black/Silver", movement: "Automatic Calibre 2385", waterResistance: "50m" } },
    { id: "ap-03", name: "Royal Oak Offshore Diver", reference: "15720ST", price: "$30,200", description: "Built for the extremes. A robust, oversized take on the Royal Oak design with an internal rotating diving bezel and quick-release strap.", cloudinaryId: "ap3", specs: { case: "42mm Steel", dial: "Khaki Green", movement: "Automatic Calibre 4308", waterResistance: "300m" } },
    { id: "ap-04", name: "Royal Oak Perpetual Calendar", reference: "26574OR", price: "$115,000", description: "A grand complication presented in stunning 18-carat pink gold, accurately tracking the date, day, month, moon phase, and leap year.", cloudinaryId: "ap4", specs: { case: "41mm Rose Gold", dial: "Blue Aventurine", movement: "Automatic Calibre 5134", waterResistance: "20m" } },
    { id: "ap-05", name: "Code 11.59 Chronograph", reference: "26393BC", price: "$48,000", description: "A contemporary masterpiece. The complex multi-part case architecture blends an octagonal middle case with a round bezel and double-curved sapphire crystal.", cloudinaryId: "ap5", specs: { case: "41mm White Gold", dial: "Smoked Burgundy", movement: "Automatic Calibre 4401", waterResistance: "30m" } }
  ],
  "bentley": [
    { id: "ben-01", name: "Bentley Motors Chronograph", reference: "A25362", price: "$8,500", description: "Inspired by the automotive world, featuring a knurled bezel reminiscent of Bentley control buttons and a robust chronograph movement.", cloudinaryId: "bentley1", specs: { case: "48.8mm Steel", dial: "Bronze", movement: "Automatic Chronograph", waterResistance: "100m" } },
    { id: "ben-02", name: "Bentley GT Dark Sapphire", reference: "XB0613", price: "$9,200", description: "A striking tribute to the Continental GT, utilizing an ultra-light, ultra-sturdy proprietary polymer case with a deep sapphire blue dial.", cloudinaryId: "bentley2", specs: { case: "48mm Breitlight®", dial: "Dark Sapphire", movement: "Automatic", waterResistance: "100m" } },
    { id: "ben-03", name: "B06 Midnight Carbon", reference: "MB0611", price: "$11,500", description: "A stealthy, high-performance timepiece with a black steel case and a distinctive open-worked dial revealing the engine within.", cloudinaryId: "bentley3", specs: { case: "49mm Black Steel", dial: "Skeletonized", movement: "In-House Calibre B06", waterResistance: "100m" } },
    { id: "ben-04", name: "Premier B21 Tourbillon", reference: "RB2120", price: "$52,000", description: "The pinnacle of the partnership. A stunning tourbillon complication housed in a refined 18k red gold case with British racing green accents.", cloudinaryId: "bentley4", specs: { case: "42mm Red Gold", dial: "British Racing Green", movement: "Automatic Tourbillon", waterResistance: "100m" } },
    { id: "ben-05", name: "Supersports Light Body", reference: "E27365", price: "$7,800", description: "Designed for speed. Crafted entirely from titanium for an incredibly lightweight feel, paired with a dynamic racing-inspired dashboard dial.", cloudinaryId: "bentley5", specs: { case: "49mm Titanium", dial: "Carbon Fiber", movement: "Automatic Chronograph", waterResistance: "100m" } },
    { id: "ben-06", name: "Flying B Chronograph", reference: "A44365", price: "$6,500", description: "A departure from the traditional round case. The Flying B features a dramatic rectangular cambered profile with jumping hour mechanisms.", cloudinaryId: "bentley6", specs: { case: "38.5mm x 58.4mm Steel", dial: "Opaline White", movement: "Automatic", waterResistance: "100m" } },
    { id: "ben-07", name: "GMT Light Body B04", reference: "EB0433", price: "$10,500", description: "The ultimate traveler's watch. An asymmetrical titanium case featuring a highly legible secondary time zone and world-time bezel.", cloudinaryId: "bentley7", specs: { case: "49mm Titanium", dial: "Tungsten Grey", movement: "Automatic GMT", waterResistance: "100m" } },
    { id: "ben-08", name: "Centenary Limited Edition", reference: "RB0118", price: "$28,000", description: "Celebrating 100 years of Bentley Motors. The dial incorporates actual elm burl wood salvaged from the legendary 1929 'Blower' Bentley.", cloudinaryId: "bentley8", specs: { case: "42mm Rose Gold", dial: "Brown Elm Burl", movement: "In-House Calibre 01", waterResistance: "100m" } }
  ],
  "burberry": [
    { id: "bur-01", name: "The City Classic", reference: "BU9001", price: "$495", description: "Reflecting London's modern skyline, this timepiece features the signature Burberry check stamped onto a silver sunray dial.", cloudinaryId: "burberry1", specs: { case: "38mm Steel", dial: "Silver Check", movement: "Swiss Quartz", waterResistance: "50m" } },
    { id: "bur-02", name: "The Britain Automatic", reference: "BBY1000", price: "$1,795", description: "A robust, elegantly shaped case inspired by the iconic Burberry trench coat D-rings, featuring an open caseback revealing the automatic movement.", cloudinaryId: "burberry2", specs: { case: "43mm Steel", dial: "Matte Black", movement: "Automatic", waterResistance: "50m" } }
  ],
  "calvin-klein": [
    { id: "ck-01", name: "Minimalist Mesh", reference: "K3M2112Z", price: "$220", description: "Pure, sleek, and timeless. Features an ultra-thin case and a stainless steel mesh bracelet that wraps seamlessly around the wrist.", cloudinaryId: "ck1", specs: { case: "40mm Steel", dial: "Silver Sunray", movement: "Swiss Quartz", waterResistance: "30m" } },
    { id: "ck-02", name: "High Noon Chronograph", reference: "K8M27126", price: "$290", description: "Retro-modern aesthetic with curved glass, a pebble-shaped case, and precise chronograph functions for a sophisticated everyday look.", cloudinaryId: "ck2", specs: { case: "43mm Steel", dial: "Silver", movement: "Quartz Chronograph", waterResistance: "50m" } },
    { id: "ck-03", name: "City Classic", reference: "K2G2G121", price: "$195", description: "An enduring design reflecting metropolitan architecture. Clean lines, a stark black dial, and a polished stainless steel finish.", cloudinaryId: "ck3", specs: { case: "43mm Steel", dial: "Black", movement: "Swiss Quartz", waterResistance: "30m" } },
    { id: "ck-04", name: "Even Extension", reference: "K7B211C1", price: "$240", description: "A study in contrasting textures. A subtle textured dial paired with a smooth leather strap brings a touch of warmth to stark minimalism.", cloudinaryId: "ck4", specs: { case: "42mm Steel", dial: "Charcoal", movement: "Quartz", waterResistance: "30m" } }
  ]
};

export default function BrandShopPage({
  params,
}: {
  params: Promise<{ brand: string }>;
}) {
  // UNWRAP THE PROMISE HERE
  const resolvedParams = use(params);

  const [selectedWatch, setSelectedWatch] = useState<any | null>(null);

  const formattedBrandName = resolvedParams.brand
    .replace(/-/g, " ")
    .toUpperCase();

  const currentInventory = INVENTORY_DATABASE[resolvedParams.brand] || [];

  const getCloudinaryUrl = (publicId: string, width: number = 800) => {
    return `https://res.cloudinary.com/e6lmzxgm/image/upload/c_fit,w_${width},q_auto,f_auto/${publicId}`;
  };

  return (
    // Translucent glass overlay sitting on top of layout's persistent .elite-shell and WatchImageBackdrop
    <main className="shop-glass-overlay relative min-h-screen text-white selection:bg-[#D4AF37] selection:text-black font-sans">
      {/* MAIN PAGE CONTENT */}

      {/* HEADER */}
      <header className="sticky top-0 z-40 w-full backdrop-blur-md bg-[#0a0a0a]/80 border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-sm tracking-widest text-white/60 hover:text-[#D4AF37] transition-colors uppercase"
          >
            ← Back to Graph
          </Link>
          <h1 className="text-xl md:text-2xl font-light tracking-[0.2em]">
            {formattedBrandName}{" "}
            <span className="text-[#D4AF37]">COLLECTION</span>
          </h1>
        </div>
      </header>

      {/* PRODUCT GRID */}
      <section className="p-6 md:p-12 max-w-[1600px] mx-auto">
        {currentInventory.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-white/50">
            <p className="text-xl tracking-widest uppercase">Collection Updating</p>
            <p className="text-sm mt-2 font-mono">Check back soon for {formattedBrandName} timepieces.</p>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {currentInventory.map((watch, index) => (
            <motion.div
              key={watch.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: index * 0.1,
                duration: 0.6,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="group cursor-pointer flex flex-col"
              onClick={() => setSelectedWatch(watch)}
            >
              <div className="relative aspect-[3/4] bg-[#111] rounded-lg overflow-hidden mb-4 border border-white/5 group-hover:border-[#D4AF37]/50 transition-colors duration-500">
                <Image
                  src={getCloudinaryUrl(watch.cloudinaryId, 600)}
                  alt={watch.name}
                  fill
                  className="object-cover transform group-hover:scale-105 transition-transform duration-700 ease-out"
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                />
                {/* Subtle overlay gradient */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              </div>

              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-lg font-medium tracking-wide group-hover:text-[#D4AF37] transition-colors">
                    {watch.name}
                  </h2>
                  <p className="text-sm text-white/50 font-mono mt-1">
                    {watch.reference}
                  </p>
                </div>
                <span className="text-md font-light tracking-wider">
                  {watch.price}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ZOOM & DRAWER INSPECTOR */}
      <AnimatePresence>
        {selectedWatch && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
              onClick={() => setSelectedWatch(null)}
            />

            {/* Side Drawer */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed top-0 right-0 h-full w-full md:w-[500px] bg-[#0f0f0f] border-l border-white/10 z-50 flex flex-col shadow-2xl"
            >
              {/* Drawer Header */}
              <div className="flex items-center justify-between p-6 border-b border-white/10">
                <span className="text-xs font-mono tracking-widest text-[#D4AF37] uppercase">
                  {formattedBrandName} Inspector
                </span>
                <button
                  onClick={() => setSelectedWatch(null)}
                  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-xl"
                  aria-label="Close inspector"
                >
                  ✕
                </button>
              </div>

              {/* Drawer Content */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden">
                <div className="relative w-full aspect-square bg-[#050505]">
                  <Image
                    src={getCloudinaryUrl(selectedWatch.cloudinaryId, 1000)}
                    alt={selectedWatch.name}
                    fill
                    className="object-contain"
                  />
                </div>

                <div className="p-8">
                  <h2 className="text-3xl font-light mb-2">
                    {selectedWatch.name}
                  </h2>
                  <p className="text-xl font-mono text-[#D4AF37] mb-6">
                    {selectedWatch.price}
                  </p>

                  <p className="text-white/70 leading-relaxed mb-8">
                    {selectedWatch.description}
                  </p>

                  <div className="grid grid-cols-2 gap-y-6 gap-x-4 border-t border-white/10 pt-8">
                    <div>
                      <p className="text-xs uppercase tracking-widest text-white/40 mb-1">
                        Case
                      </p>
                      <p className="text-sm tracking-wide">
                        {selectedWatch.specs.case}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-widest text-white/40 mb-1">
                        Dial
                      </p>
                      <p className="text-sm tracking-wide">
                        {selectedWatch.specs.dial}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-widest text-white/40 mb-1">
                        Movement
                      </p>
                      <p className="text-sm tracking-wide">
                        {selectedWatch.specs.movement}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-widest text-white/40 mb-1">
                        Water Res.
                      </p>
                      <p className="text-sm tracking-wide">
                        {selectedWatch.specs.waterResistance}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Drawer Footer / Action */}
              <div className="p-6 border-t border-white/10 bg-[#0a0a0a]">
                <button className="w-full py-4 bg-white text-black font-medium tracking-widest uppercase hover:bg-[#D4AF37] hover:text-black transition-colors duration-300 rounded-sm">
                  Inquire About This Piece
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </main>
  );
}
