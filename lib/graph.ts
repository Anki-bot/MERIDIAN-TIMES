import type { DictionaryTerm, WatchAudience } from "./types";

export type GraphNodeKind = "audience" | "brand" | "watch";

export interface GraphNodeDefinition {
  readonly id: string;
  readonly termId: string;
  readonly kind: GraphNodeKind;
  readonly desktop: { readonly x: number; readonly y: number };
  readonly mobile: { readonly x: number; readonly y: number };
  readonly logo?: string;
  readonly logoTheme?: "dark" | "light";
  readonly name?: string;
  readonly categories?: readonly string[];
}

export interface GraphEdge {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
  readonly fromTermId: string;
  readonly toTermId: string;
  readonly active: boolean;
  readonly emphasized: boolean;
}

export const GRAPH_NODES: readonly GraphNodeDefinition[] = Object.freeze([
  {
    id: "men",
    termId: "men",
    kind: "audience",
    desktop: { x: 32, y: 55 },
    mobile: { x: 30, y: 33 },
  },
  {
    id: "women",
    termId: "women",
    kind: "audience",
    desktop: { x: 67, y: 55 },
    mobile: { x: 70, y: 33 },
  },
  {
    id: "audemars-piguet",
    termId: "audemars-piguet",
    kind: "brand",
    desktop: { x: 56, y: 68 },
    mobile: { x: 58, y: 76 },
    logo: "/assets/watch/logos/ap.png",
    logoTheme: "dark",
    name: "AUDEMARS PIGUET",
    categories: ["Men", "Women"],
  },
  {
    id: "armani-exchange",
    termId: "armani-exchange",
    kind: "brand",
    desktop: { x: 30, y: 70 },
    mobile: { x: 28, y: 75 },
    logo: "/assets/watch/logos/ax.png",
    logoTheme: "dark",
    name: "ARMANI EXCHANGE",
    categories: ["Men", "Women"],
  },
  {
    id: "bentley",
    termId: "bentley",
    kind: "brand",
    desktop: { x: 40, y: 78 },
    mobile: { x: 38, y: 83 },
    logo: "/assets/watch/logos/bentley.png",
    logoTheme: "dark",
    name: "BENTLEY",
    categories: ["Men", "Women"],
  },
  {
    id: "hugo-boss",
    termId: "hugo-boss",
    kind: "brand",
    desktop: { x: 50, y: 85 },
    mobile: { x: 48, y: 90 },
    logo: "/assets/watch/logos/boss.png",
    logoTheme: "dark",
    name: "HUGO BOSS",
    categories: ["Men", "Women"],
  },
  {
    id: "burberry",
    termId: "burberry",
    kind: "brand",
    desktop: { x: 60, y: 85 },
    mobile: { x: 58, y: 90 },
    logo: "/assets/watch/logos/burberry.png",
    logoTheme: "dark",
    name: "BURBERRY",
    categories: ["Men", "Women"],
  },
  {
    id: "cartier",
    termId: "cartier",
    kind: "brand",
    desktop: { x: 76, y: 47 },
    mobile: { x: 85, y: 48 },
    logo: "/assets/watch/logos/cartier.png",
    logoTheme: "dark",
    name: "CARTIER",
    categories: ["Men", "Women"],
  },
  {
    id: "citizen",
    termId: "citizen",
    kind: "brand",
    desktop: { x: 74.1, y: 34.9 },
    mobile: { x: 78.4, y: 32.3 },
    logo: "/assets/watch/logos/citizen.png",
    logoTheme: "dark",
    name: "CITIZEN",
    categories: ["Men", "Women"],
  },
  {
    id: "calvin-klein",
    termId: "calvin-klein",
    kind: "brand",
    desktop: { x: 76.6, y: 37 },
    mobile: { x: 81.2, y: 35.1 },
    logo: "/assets/watch/logos/ck.png",
    logoTheme: "dark",
    name: "CALVIN KLEIN",
    categories: ["Men", "Women"],
  },
  {
    id: "diesel",
    termId: "diesel",
    kind: "brand",
    desktop: { x: 70, y: 78 },
    mobile: { x: 68, y: 83 },
    logo: "/assets/watch/logos/diesel.png",
    logoTheme: "light",
    name: "DIESEL",
    categories: ["Men", "Women"],
  },
  {
    id: "emporio-armani",
    termId: "emporio-armani",
    kind: "brand",
    desktop: { x: 80.8, y: 48.2 },
    mobile: { x: 85.8, y: 48 },
    logo: "/assets/watch/logos/ea.png",
    logoTheme: "dark",
    name: "EMPORIO ARMANI",
    categories: ["Men", "Women"],
  },
  {
    id: "edifice",
    termId: "edifice",
    kind: "brand",
    desktop: { x: 77.8, y: 52.7 },
    mobile: { x: 82.8, y: 53.4 },
    logo: "/assets/watch/logos/edifice.png",
    logoTheme: "dark",
    name: "EDIFICE",
    categories: ["Men", "Women"],
  },
  {
    id: "fossil",
    termId: "fossil",
    kind: "brand",
    desktop: { x: 78.4, y: 60.8 },
    mobile: { x: 83.2, y: 62.2 },
    logo: "/assets/watch/logos/fossil.png",
    logoTheme: "light",
    name: "FOSSIL",
    categories: ["Men", "Women"],
  },
  {
    id: "franck-muller",
    termId: "franck-muller",
    kind: "brand",
    desktop: { x: 78.8, y: 61.9 },
    mobile: { x: 83.3, y: 64.2 },
    logo: "/assets/watch/logos/franckmuller.png",
    logoTheme: "dark",
    name: "FRANCK MULLER",
    categories: ["Men", "Women"],
  },
  {
    id: "g-shock",
    termId: "g-shock",
    kind: "brand",
    desktop: { x: 73.9, y: 67.9 },
    mobile: { x: 77.9, y: 70.9 },
    logo: "/assets/watch/logos/gshock.png",
    logoTheme: "dark",
    name: "G-SHOCK",
    categories: ["Men", "Women"],
  },
  {
    id: "gucci",
    termId: "gucci",
    kind: "brand",
    desktop: { x: 68.8, y: 73.1 },
    mobile: { x: 72.3, y: 76.7 },
    logo: "/assets/watch/logos/gucci.png",
    logoTheme: "dark",
    name: "GUCCI",
    categories: ["Men", "Women"],
  },
  {
    id: "guess",
    termId: "guess",
    kind: "brand",
    desktop: { x: 67.5, y: 72.9 },
    mobile: { x: 70.3, y: 77 },
    logo: "/assets/watch/logos/guess.png",
    logoTheme: "dark",
    name: "GUESS",
    categories: ["Men", "Women"],
  },
  {
    id: "hublot",
    termId: "hublot",
    kind: "brand",
    desktop: { x: 68, y: 81 },
    mobile: { x: 62, y: 89 },
    logo: "/assets/watch/logos/hublot.png",
    logoTheme: "dark",
    name: "HUBLOT",
    categories: ["Men", "Women"],
  },
  {
    id: "jacob-co",
    termId: "jacob-co",
    kind: "brand",
    desktop: { x: 56.4, y: 79.4 },
    mobile: { x: 57.6, y: 84.2 },
    logo: "/assets/watch/logos/jacobco.png",
    logoTheme: "dark",
    name: "JACOB & CO.",
    categories: ["Men", "Women"],
  },
  {
    id: "lacoste",
    termId: "lacoste",
    kind: "brand",
    desktop: { x: 51.1, y: 78.2 },
    mobile: { x: 51.5, y: 83.2 },
    logo: "/assets/watch/logos/lacoste.png",
    logoTheme: "dark",
    name: "LACOSTE",
    categories: ["Men", "Women"],
  },
  {
    id: "longines",
    termId: "longines",
    kind: "brand",
    desktop: { x: 49, y: 81.8 },
    mobile: { x: 48.6, y: 85 },
    logo: "/assets/watch/logos/longines.png",
    logoTheme: "dark",
    name: "LONGINES",
    categories: ["Men", "Women"],
  },
  {
    id: "maserati",
    termId: "maserati",
    kind: "brand",
    desktop: { x: 43.5, y: 78.2 },
    mobile: { x: 42.2, y: 83 },
    logo: "/assets/watch/logos/maserati.png",
    logoTheme: "dark",
    name: "MASERATI",
    categories: ["Men", "Women"],
  },
  {
    id: "michael-kors",
    termId: "michael-kors",
    kind: "brand",
    desktop: { x: 35.8, y: 76.6 },
    mobile: { x: 33.8, y: 81.1 },
    logo: "/assets/watch/logos/mk.png",
    logoTheme: "dark",
    name: "MICHAEL KORS",
    categories: ["Men", "Women"],
  },
  {
    id: "movado",
    termId: "movado",
    kind: "brand",
    desktop: { x: 75, y: 70 },
    mobile: { x: 75, y: 75 },
    logo: "/assets/watch/logos/movado.png",
    logoTheme: "dark",
    name: "MOVADO",
    categories: ["Men", "Women"],
  },
  {
    id: "omega",
    termId: "omega",
    kind: "brand",
    desktop: { x: 20, y: 56 },
    mobile: { x: 16, y: 58 },
    logo: "/assets/watch/logos/omega.png",
    logoTheme: "dark",
    name: "OMEGA",
    categories: ["Men", "Women"],
  },
  {
    id: "orient",
    termId: "orient",
    kind: "brand",
    desktop: { x: 26, y: 68.3 },
    mobile: { x: 21.9, y: 71.3 },
    logo: "/assets/watch/logos/orient.png",
    logoTheme: "dark",
    name: "ORIENT",
    categories: ["Men", "Women"],
  },
  {
    id: "patek-philippe",
    termId: "patek-philippe",
    kind: "brand",
    desktop: { x: 24, y: 47 },
    mobile: { x: 15, y: 48 },
    logo: "/assets/watch/logos/patek_philippe.png",
    logoTheme: "light",
    name: "PATEK PHILIPPE",
    categories: ["Men", "Women"],
  },
  {
    id: "rado",
    termId: "rado",
    kind: "brand",
    desktop: { x: 21.7, y: 56.8 },
    mobile: { x: 17, y: 58.3 },
    logo: "/assets/watch/logos/rado.png",
    logoTheme: "dark",
    name: "RADO",
    categories: ["Men", "Women"],
  },
  {
    id: "richard-mille",
    termId: "richard-mille",
    kind: "brand",
    desktop: { x: 22.1, y: 55.3 },
    mobile: { x: 17.2, y: 55.9 },
    logo: "/assets/watch/logos/richardmill.png",
    logoTheme: "dark",
    name: "RICHARD MILLE",
    categories: ["Men", "Women"],
  },
  {
    id: "rolex",
    termId: "rolex",
    kind: "brand",
    desktop: { x: 22, y: 65 },
    mobile: { x: 20, y: 68 },
    logo: "/assets/watch/logos/rolex.png",
    logoTheme: "light",
    name: "ROLEX",
    categories: ["Men", "Women"],
  },
  {
    id: "seiko",
    termId: "seiko",
    kind: "brand",
    desktop: { x: 19, y: 42.2 },
    mobile: { x: 14.1, y: 41.1 },
    logo: "/assets/watch/logos/seiko.png",
    logoTheme: "dark",
    name: "SEIKO",
    categories: ["Men", "Women"],
  },
  {
    id: "sevenfriday",
    termId: "sevenfriday",
    kind: "brand",
    desktop: { x: 23.5, y: 40.8 },
    mobile: { x: 18.9, y: 38.9 },
    logo: "/assets/watch/logos/sevenfriday.png",
    logoTheme: "dark",
    name: "SEVENFRIDAY",
    categories: ["Men", "Women"],
  },
  {
    id: "swarovski",
    termId: "swarovski",
    kind: "brand",
    desktop: { x: 25.8, y: 33.1 },
    mobile: { x: 21.5, y: 30.5 },
    logo: "/assets/watch/logos/swarovski.png",
    logoTheme: "dark",
    name: "SWAROVSKI",
    categories: ["Men", "Women"],
  },
  {
    id: "tag-heuer",
    termId: "tag-heuer",
    kind: "brand",
    desktop: { x: 76, y: 65 },
    mobile: { x: 80, y: 68 },
    logo: "/assets/watch/logos/tagheuer.png",
    logoTheme: "light",
    name: "TAG HEUER",
    categories: ["Men", "Women"],
  },
  {
    id: "tissot",
    termId: "tissot",
    kind: "brand",
    desktop: { x: 30.3, y: 28.4 },
    mobile: { x: 27.1, y: 24.5 },
    logo: "/assets/watch/logos/tissot.png",
    logoTheme: "light",
    name: "TISSOT",
    categories: ["Men", "Women"],
  },
  {
    id: "tommy-hilfiger",
    termId: "tommy-hilfiger",
    kind: "brand",
    desktop: { x: 37.3, y: 21.9 },
    mobile: { x: 34.8, y: 18 },
    logo: "/assets/watch/logos/tommy.png",
    logoTheme: "light",
    name: "TOMMY HILFIGER",
    categories: ["Men", "Women"],
  },
  {
    id: "vacheron-constantin",
    termId: "vacheron-constantin",
    kind: "brand",
    desktop: { x: 40.4, y: 22.5 },
    mobile: { x: 38.7, y: 18 },
    logo: "/assets/watch/logos/vacheron.png",
    logoTheme: "dark",
    name: "VACHERON CONSTANTIN",
    categories: ["Men", "Women"],
  },
  {
    id: "versace",
    termId: "versace",
    kind: "brand",
    desktop: { x: 42.9, y: 21.3 },
    mobile: { x: 42.1, y: 18 },
    logo: "/assets/watch/logos/versace.png",
    logoTheme: "dark",
    name: "VERSACE",
    categories: ["Men", "Women"],
  },
]);

export const WATCH_NODES: readonly GraphNodeDefinition[] = Object.freeze([
  {
    id: "audemars-piguet-watch-2",
    termId: "audemars-piguet-watch-2",
    kind: "watch",
    desktop: { x: 50, y: 21.5 },
    mobile: { x: 50, y: 18 },
  },
  {
    id: "audemars-royal-oak",
    termId: "audemars-royal-oak",
    kind: "watch",
    desktop: { x: 53.9, y: 19.1 },
    mobile: { x: 54.3, y: 18 },
  },
  {
    id: "armani-exchange-watch-1",
    termId: "armani-exchange-watch-1",
    kind: "watch",
    desktop: { x: 54.5, y: 20.2 },
    mobile: { x: 55.3, y: 18 },
  },
  {
    id: "armani-exchange-watch-2",
    termId: "armani-exchange-watch-2",
    kind: "watch",
    desktop: { x: 55.9, y: 22.1 },
    mobile: { x: 57.1, y: 18 },
  },
  {
    id: "bentley-watch-1",
    termId: "bentley-watch-1",
    kind: "watch",
    desktop: { x: 60.4, y: 20.1 },
    mobile: { x: 62, y: 18 },
  },
  {
    id: "bentley-watch-2",
    termId: "bentley-watch-2",
    kind: "watch",
    desktop: { x: 63.1, y: 23.2 },
    mobile: { x: 65.1, y: 18.6 },
  },
  {
    id: "hugo-boss-watch-1",
    termId: "hugo-boss-watch-1",
    kind: "watch",
    desktop: { x: 63.1, y: 24 },
    mobile: { x: 65.4, y: 19.6 },
  },
  {
    id: "hugo-boss-watch-2",
    termId: "hugo-boss-watch-2",
    kind: "watch",
    desktop: { x: 65.3, y: 23.4 },
    mobile: { x: 68, y: 19.2 },
  },
  {
    id: "burberry-watch-1",
    termId: "burberry-watch-1",
    kind: "watch",
    desktop: { x: 69.5, y: 27.5 },
    mobile: { x: 72.5, y: 23.5 },
  },
  {
    id: "burberry-watch-2",
    termId: "burberry-watch-2",
    kind: "watch",
    desktop: { x: 70.7, y: 27.3 },
    mobile: { x: 74.1, y: 23.6 },
  },
  {
    id: "cartier-ballon-bleu",
    termId: "cartier-ballon-bleu",
    kind: "watch",
    desktop: { x: 70.4, y: 28.6 },
    mobile: { x: 74.1, y: 25.2 },
  },
  {
    id: "cartier-panthere",
    termId: "cartier-panthere",
    kind: "watch",
    desktop: { x: 73.2, y: 32.8 },
    mobile: { x: 77.1, y: 29.7 },
  },
  {
    id: "cartier-santos",
    termId: "cartier-santos",
    kind: "watch",
    desktop: { x: 76.4, y: 32.1 },
    mobile: { x: 80.6, y: 29.3 },
  },
  {
    id: "cartier-tank",
    termId: "cartier-tank",
    kind: "watch",
    desktop: { x: 76, y: 35.4 },
    mobile: { x: 80.4, y: 33 },
  },
  {
    id: "citizen-watch-1",
    termId: "citizen-watch-1",
    kind: "watch",
    desktop: { x: 75.8, y: 38.6 },
    mobile: { x: 80.4, y: 36.5 },
  },
  {
    id: "citizen-watch-2",
    termId: "citizen-watch-2",
    kind: "watch",
    desktop: { x: 78.8, y: 38.3 },
    mobile: { x: 83.5, y: 36.6 },
  },
  {
    id: "calvin-klein-watch-1",
    termId: "calvin-klein-watch-1",
    kind: "watch",
    desktop: { x: 80.3, y: 43.1 },
    mobile: { x: 85.1, y: 41.8 },
  },
  {
    id: "calvin-klein-watch-2",
    termId: "calvin-klein-watch-2",
    kind: "watch",
    desktop: { x: 78.6, y: 44.8 },
    mobile: { x: 83.5, y: 43.9 },
  },
  {
    id: "diesel-watch-1",
    termId: "diesel-watch-1",
    kind: "watch",
    desktop: { x: 78.8, y: 45.7 },
    mobile: { x: 83.7, y: 45.2 },
  },
  {
    id: "diesel-watch-2",
    termId: "diesel-watch-2",
    kind: "watch",
    desktop: { x: 81.2, y: 50.8 },
    mobile: { x: 86.2, y: 50.7 },
  },
  {
    id: "emporio-armani-watch-1",
    termId: "emporio-armani-watch-1",
    kind: "watch",
    desktop: { x: 80.7, y: 51.2 },
    mobile: { x: 85.7, y: 51.5 },
  },
  {
    id: "emporio-armani-watch-2",
    termId: "emporio-armani-watch-2",
    kind: "watch",
    desktop: { x: 78.3, y: 53.7 },
    mobile: { x: 83.3, y: 54.4 },
  },
  {
    id: "edifice-watch-1",
    termId: "edifice-watch-1",
    kind: "watch",
    desktop: { x: 78.8, y: 58.1 },
    mobile: { x: 83.7, y: 59.2 },
  },
  {
    id: "edifice-watch-2",
    termId: "edifice-watch-2",
    kind: "watch",
    desktop: { x: 80.1, y: 57.7 },
    mobile: { x: 84.9, y: 59.2 },
  },
  {
    id: "fossil-watch-1",
    termId: "fossil-watch-1",
    kind: "watch",
    desktop: { x: 77.8, y: 61.7 },
    mobile: { x: 82.5, y: 63.6 },
  },
  {
    id: "fossil-watch-2",
    termId: "fossil-watch-2",
    kind: "watch",
    desktop: { x: 75.3, y: 64.4 },
    mobile: { x: 79.7, y: 66.7 },
  },
  {
    id: "franck-muller-watch-1",
    termId: "franck-muller-watch-1",
    kind: "watch",
    desktop: { x: 75.9, y: 64.2 },
    mobile: { x: 80.1, y: 66.8 },
  },
  {
    id: "franck-muller-watch-2",
    termId: "franck-muller-watch-2",
    kind: "watch",
    desktop: { x: 75.6, y: 68.8 },
    mobile: { x: 79.6, y: 71.8 },
  },
  {
    id: "g-shock-watch-1",
    termId: "g-shock-watch-1",
    kind: "watch",
    desktop: { x: 72, y: 69.6 },
    mobile: { x: 75.8, y: 72.9 },
  },
  {
    id: "g-shock-watch-2",
    termId: "g-shock-watch-2",
    kind: "watch",
    desktop: { x: 69.8, y: 70.3 },
    mobile: { x: 73.3, y: 73.9 },
  },
  {
    id: "gucci-watch-1",
    termId: "gucci-watch-1",
    kind: "watch",
    desktop: { x: 70.2, y: 74.6 },
    mobile: { x: 73.4, y: 78.4 },
  },
  {
    id: "gucci-watch-2",
    termId: "gucci-watch-2",
    kind: "watch",
    desktop: { x: 68.2, y: 73.7 },
    mobile: { x: 71.1, y: 77.8 },
  },
  {
    id: "guess-watch-1",
    termId: "guess-watch-1",
    kind: "watch",
    desktop: { x: 63.9, y: 75.5 },
    mobile: { x: 66.4, y: 79.9 },
  },
  {
    id: "guess-watch-2",
    termId: "guess-watch-2",
    kind: "watch",
    desktop: { x: 62.4, y: 78.3 },
    mobile: { x: 64.5, y: 82.8 },
  },
  {
    id: "hublot-watch-1",
    termId: "hublot-watch-1",
    kind: "watch",
    desktop: { x: 62.2, y: 76.6 },
    mobile: { x: 64, y: 81.3 },
  },
  {
    id: "hublot-watch-2",
    termId: "hublot-watch-2",
    kind: "watch",
    desktop: { x: 58.7, y: 79.4 },
    mobile: { x: 60.1, y: 84.2 },
  },
  {
    id: "jacob-co-watch-1",
    termId: "jacob-co-watch-1",
    kind: "watch",
    desktop: { x: 54.6, y: 80 },
    mobile: { x: 55.6, y: 84.9 },
  },
  {
    id: "jacob-co-watch-2",
    termId: "jacob-co-watch-2",
    kind: "watch",
    desktop: { x: 53.8, y: 78.3 },
    mobile: { x: 54.4, y: 83.3 },
  },
  {
    id: "lacoste-watch-1",
    termId: "lacoste-watch-1",
    kind: "watch",
    desktop: { x: 52.7, y: 81.2 },
    mobile: { x: 52.9, y: 85 },
  },
  {
    id: "lacoste-watch-2",
    termId: "lacoste-watch-2",
    kind: "watch",
    desktop: { x: 48.3, y: 79.7 },
    mobile: { x: 48.1, y: 84.7 },
  },
  {
    id: "longines-watch-1",
    termId: "longines-watch-1",
    kind: "watch",
    desktop: { x: 45, y: 78.8 },
    mobile: { x: 44.4, y: 83.8 },
  },
  {
    id: "longines-watch-2",
    termId: "longines-watch-2",
    kind: "watch",
    desktop: { x: 44.8, y: 80.9 },
    mobile: { x: 43.7, y: 85 },
  },
  {
    id: "maserati-watch-1",
    termId: "maserati-watch-1",
    kind: "watch",
    desktop: { x: 42.7, y: 77.7 },
    mobile: { x: 41.3, y: 82.5 },
  },
  {
    id: "maserati-watch-2",
    termId: "maserati-watch-2",
    kind: "watch",
    desktop: { x: 38.1, y: 77.9 },
    mobile: { x: 36.3, y: 82.6 },
  },
  {
    id: "michael-kors-watch-1",
    termId: "michael-kors-watch-1",
    kind: "watch",
    desktop: { x: 36.1, y: 78.2 },
    mobile: { x: 34, y: 82.7 },
  },
  {
    id: "michael-kors-watch-2",
    termId: "michael-kors-watch-2",
    kind: "watch",
    desktop: { x: 36.2, y: 74.4 },
    mobile: { x: 33.6, y: 78.7 },
  },
  {
    id: "movado-watch-1",
    termId: "movado-watch-1",
    kind: "watch",
    desktop: { x: 33.3, y: 75.3 },
    mobile: { x: 30.4, y: 79.4 },
  },
  {
    id: "movado-watch-2",
    termId: "movado-watch-2",
    kind: "watch",
    desktop: { x: 29.4, y: 73.5 },
    mobile: { x: 26.2, y: 77.3 },
  },
  {
    id: "omega-speedmaster",
    termId: "omega-speedmaster",
    kind: "watch",
    desktop: { x: 28.9, y: 70.1 },
    mobile: { x: 25.4, y: 73.6 },
  },
  {
    id: "omega-watch-2",
    termId: "omega-watch-2",
    kind: "watch",
    desktop: { x: 28.8, y: 71 },
    mobile: { x: 25, y: 74.3 },
  },
  {
    id: "orient-watch-1",
    termId: "orient-watch-1",
    kind: "watch",
    desktop: { x: 25.5, y: 67.2 },
    mobile: { x: 21.5, y: 70.2 },
  },
  {
    id: "orient-watch-2",
    termId: "orient-watch-2",
    kind: "watch",
    desktop: { x: 23, y: 65 },
    mobile: { x: 18.7, y: 67.6 },
  },
  {
    id: "patek-calatrava",
    termId: "patek-calatrava",
    kind: "watch",
    desktop: { x: 23.9, y: 65 },
    mobile: { x: 19.4, y: 67.3 },
  },
  {
    id: "patek-nautilus",
    termId: "patek-nautilus",
    kind: "watch",
    desktop: { x: 23.5, y: 60.1 },
    mobile: { x: 18.9, y: 62 },
  },
  {
    id: "rado-watch-1",
    termId: "rado-watch-1",
    kind: "watch",
    desktop: { x: 20.4, y: 59.2 },
    mobile: { x: 15.7, y: 60.7 },
  },
  {
    id: "rado-watch-2",
    termId: "rado-watch-2",
    kind: "watch",
    desktop: { x: 19.7, y: 57.7 },
    mobile: { x: 14.9, y: 58.8 },
  },
  {
    id: "richard-mille-watch-1",
    termId: "richard-mille-watch-1",
    kind: "watch",
    desktop: { x: 21.5, y: 52.8 },
    mobile: { x: 16.6, y: 53.5 },
  },
  {
    id: "richard-mille-watch-2",
    termId: "richard-mille-watch-2",
    kind: "watch",
    desktop: { x: 20.8, y: 52.8 },
    mobile: { x: 15.8, y: 53.1 },
  },
  {
    id: "rolex-datejust",
    termId: "rolex-datejust",
    kind: "watch",
    desktop: { x: 18.6, y: 49.6 },
    mobile: { x: 13.6, y: 49.5 },
  },
  {
    id: "rolex-daytona",
    termId: "rolex-daytona",
    kind: "watch",
    desktop: { x: 19.8, y: 45.7 },
    mobile: { x: 14.8, y: 45.2 },
  },
  {
    id: "rolex-submariner",
    termId: "rolex-submariner",
    kind: "watch",
    desktop: { x: 22, y: 46 },
    mobile: { x: 17.1, y: 45.1 },
  },
  {
    id: "seiko-watch-1",
    termId: "seiko-watch-1",
    kind: "watch",
    desktop: { x: 21, y: 41.4 },
    mobile: { x: 16.2, y: 40.1 },
  },
  {
    id: "seiko-watch-2",
    termId: "seiko-watch-2",
    kind: "watch",
    desktop: { x: 20.3, y: 39.3 },
    mobile: { x: 15.6, y: 37.6 },
  },
  {
    id: "sevenfriday-watch-1",
    termId: "sevenfriday-watch-1",
    kind: "watch",
    desktop: { x: 23.1, y: 38.9 },
    mobile: { x: 18.6, y: 36.8 },
  },
  {
    id: "sevenfriday-watch-2",
    termId: "sevenfriday-watch-2",
    kind: "watch",
    desktop: { x: 25.2, y: 34 },
    mobile: { x: 20.8, y: 31.6 },
  },
  {
    id: "swarovski-watch-1",
    termId: "swarovski-watch-1",
    kind: "watch",
    desktop: { x: 24.3, y: 33.7 },
    mobile: { x: 20.2, y: 30.9 },
  },
  {
    id: "swarovski-watch-2",
    termId: "swarovski-watch-2",
    kind: "watch",
    desktop: { x: 25.4, y: 32.1 },
    mobile: { x: 21.5, y: 29 },
  },
  {
    id: "tag-heuer-watch-1",
    termId: "tag-heuer-watch-1",
    kind: "watch",
    desktop: { x: 29.2, y: 28 },
    mobile: { x: 25.6, y: 24.5 },
  },
  {
    id: "tag-heuer-watch-2",
    termId: "tag-heuer-watch-2",
    kind: "watch",
    desktop: { x: 30.8, y: 28.9 },
    mobile: { x: 27.4, y: 25.2 },
  },
  {
    id: "tissot-watch-1",
    termId: "tissot-watch-1",
    kind: "watch",
    desktop: { x: 30.5, y: 26.1 },
    mobile: { x: 27.4, y: 22.1 },
  },
  {
    id: "tissot-watch-2",
    termId: "tissot-watch-2",
    kind: "watch",
    desktop: { x: 33.2, y: 23.7 },
    mobile: { x: 30.5, y: 19.5 },
  },
  {
    id: "tommy-hilfiger-watch-1",
    termId: "tommy-hilfiger-watch-1",
    kind: "watch",
    desktop: { x: 37.3, y: 25 },
    mobile: { x: 35, y: 20.6 },
  },
  {
    id: "tommy-hilfiger-watch-2",
    termId: "tommy-hilfiger-watch-2",
    kind: "watch",
    desktop: { x: 38.3, y: 21.5 },
    mobile: { x: 36.3, y: 18 },
  },
  {
    id: "vacheron-constantin-watch-1",
    termId: "vacheron-constantin-watch-1",
    kind: "watch",
    desktop: { x: 38.9, y: 21.3 },
    mobile: { x: 37.3, y: 18 },
  },
  {
    id: "vacheron-constantin-watch-2",
    termId: "vacheron-constantin-watch-2",
    kind: "watch",
    desktop: { x: 42.9, y: 22.2 },
    mobile: { x: 41.7, y: 18 },
  },
  {
    id: "versace-watch-1",
    termId: "versace-watch-1",
    kind: "watch",
    desktop: { x: 46.6, y: 19 },
    mobile: { x: 45.8, y: 18 },
  },
  {
    id: "versace-watch-2",
    termId: "versace-watch-2",
    kind: "watch",
    desktop: { x: 47, y: 20.7 },
    mobile: { x: 46.6, y: 18 },
  },
]);

const AUDIENCE_LINK_ID = "men--women";
const graphNodeById = new Map(GRAPH_NODES.map((node) => [node.id, node]));

function isAudience(value: string): value is WatchAudience {
  return value === "men" || value === "women";
}

export function getGraphNode(presentationId: string): GraphNodeDefinition | undefined {
  return graphNodeById.get(presentationId);
}

export function isGraphNodeEnabled(
  term: DictionaryTerm,
  activeAudience: WatchAudience | null,
  activeBrand: string | null = null,
): boolean {
  if (term.kind === "collection") return true;
  if (term.kind === "specific-watch") {
    return (
      activeBrand !== null &&
      term.parentIds.includes(activeBrand) &&
      (activeAudience === null || term.audiences.includes(activeAudience))
    );
  }
  return activeAudience !== null && term.audiences.includes(activeAudience);
}

export function buildRestingGraphEdges(
  terms: readonly DictionaryTerm[],
): readonly GraphEdge[] {
  const termById = new Map(terms.map((term) => [term.id, term]));
  const audienceLink: GraphEdge = {
    id: AUDIENCE_LINK_ID,
    fromId: "men",
    toId: "women",
    fromTermId: "men",
    toTermId: "women",
    active: false,
    emphasized: false,
  };

  const brandEdges = GRAPH_NODES
    .filter((node) => node.kind === "brand")
    .flatMap((node): GraphEdge[] => {
      const term = termById.get(node.termId);
      if (!term) return [];

      return term.audiences.flatMap((audience): GraphEdge[] => {
        if (!isAudience(audience) || !graphNodeById.has(audience)) return [];
        return [{
          id: `${audience}--${node.id}`,
          fromId: audience,
          toId: node.id,
          fromTermId: audience,
          toTermId: term.id,
          active: false,
          emphasized: false,
        }];
      });
    });

  return [audienceLink, ...brandEdges];
}

export function buildGraphEdges(
  terms: readonly DictionaryTerm[],
  activeAudience: WatchAudience | null,
  selectedTermId: string | null,
  previewNodeId: string | null = null,
  activeBrand: string | null = null,
): readonly GraphEdge[] {
  const restingEdges = buildRestingGraphEdges(terms);
  const previewNode = previewNodeId ? graphNodeById.get(previewNodeId) : undefined;

  let visibleEdges: readonly GraphEdge[];
  if (previewNode?.kind === "watch") {
    visibleEdges = restingEdges.filter((edge) => edge.toId === previewNode.id);
  } else if (previewNode?.kind === "brand") {
    visibleEdges = restingEdges.filter((edge) => edge.toId === previewNode.id);
  } else if (previewNode?.kind === "audience" && isAudience(previewNode.termId)) {
    visibleEdges = restingEdges.filter(
      (edge) => edge.id === AUDIENCE_LINK_ID || edge.fromTermId === previewNode.termId,
    );
  } else if (activeBrand) {
    const watchesForBrand = terms
      .filter((t) => t.kind === "specific-watch" && t.parentIds.includes(activeBrand))
      .flatMap((t) => WATCH_NODES.filter((n) => n.termId === t.id).map((n) => n.id));
    // Build watch edges on the fly for the active brand
    const watchEdgesForBrand = watchesForBrand.flatMap((watchId): GraphEdge[] => {
      const watchNode = WATCH_NODES.find((n) => n.id === watchId);
      const term = terms.find((t) => t.id === watchNode?.termId);
      if (!watchNode || !term) return [];
      const parentNode = GRAPH_NODES.find((n) => n.termId === activeBrand);
      if (!parentNode) return [];
      return [{
        id: `${parentNode.id}--${watchNode.id}`,
        fromId: parentNode.id,
        toId: watchNode.id,
        fromTermId: activeBrand,
        toTermId: term.id,
        active: false,
        emphasized: false,
      }];
    });
    visibleEdges = [...watchEdgesForBrand];
  } else if (activeAudience) {
    visibleEdges = restingEdges.filter(
      (edge) => edge.id === AUDIENCE_LINK_ID || edge.fromTermId === activeAudience,
    );
  } else {
    visibleEdges = [];
  }

  return visibleEdges.map((edge) => ({
    ...edge,
    active: true,
    emphasized: previewNode
      ? edge.fromId === previewNode.id || edge.toId === previewNode.id
      : edge.toTermId === selectedTermId,
  }));
}

export function audienceForTerm(
  term: DictionaryTerm,
  currentAudience: WatchAudience | null,
): WatchAudience {
  if (term.id === "men" || term.id === "women") return term.id;
  if (currentAudience && term.audiences.includes(currentAudience)) return currentAudience;
  return term.audiences[0] ?? "men";
}
