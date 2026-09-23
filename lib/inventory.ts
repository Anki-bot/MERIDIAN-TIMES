export interface WatchProduct {
  id: string;
  brandId: string;
  brandName: string;
  name: string;
  price: number;
  gender: "Men" | "Women" | "Unisex";
  imageSrc: string;
  rating: number;
  description: string;
  specifications: {
    movement: string;
    caseMaterial: string;
    strapMaterial: string;
    waterResistance: string;
  };
}

export const WATCH_INVENTORY: WatchProduct[] = [
  {
    id: "rolex-sub-1",
    brandId: "rolex",
    brandName: "Rolex",
    name: "Submariner Date",
    price: 850000,
    gender: "Unisex",
    // Leveraging Cloudinary's auto-optimization flags (q_auto, f_auto) for supreme quality
    imageSrc: "https://res.cloudinary.com/your-cloud-name/image/upload/q_auto,f_auto/watches/rolex-sub-1.webp",
    rating: 4.9,
    description: "The reference among divers' watches, featuring a unidirectional rotatable bezel and solid-link Oyster bracelet.",
    specifications: {
      movement: "Automatic Mechanical (Calibre 3235)",
      caseMaterial: "Oystersteel",
      strapMaterial: "Oystersteel",
      waterResistance: "300 meters / 1,000 feet",
    },
  },
  // You can replicate this structure for your other watches using their exact brand IDs
];