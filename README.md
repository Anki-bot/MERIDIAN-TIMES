# Meridian Times ⏱️

*An immersive 3D spatial dictionary and interactive visual atlas exploring haute horlogerie, mechanical complications, and elite brand hierarchies.*

**🌍 Live Application:** https://meridian-times-sand.vercel.app/

## 📖 Overview
Meridian Times bridges the gap between digital product execution and mechanical watchmaking. It serves as a dynamic horological database where users can visually explore the intricate relationships between luxury maisons (e.g., Audemars Piguet, Patek Philippe, Rolex) and the mechanical innovations that define them. 

Engineered for performance and immersion, the application features a live-rendered 3D mechanical watch movement, an interactive node-based brand constellation, and a fully searchable technical dictionary wrapped in a modern glassmorphic interface.

## ✨ Key Features
* **Interactive 3D Mechanics:** A real-time, WebGL-rendered mechanical watch movement built with React Three Fiber, featuring a mathematically animated gear train, balance wheel, and escapement.
* **Spatial Brand Network:** A dynamic, interactive node graph mapping the horological landscape. Users can navigate connections between specific audiences, brands, and individual watch models.
* **Responsive 2.5D Architecture:** An advanced rendering engine that seamlessly transitions between rich 3D canvases, fallback 2.5D layered imaging, and static UI overlays based on device capabilities and user accessibility preferences.
* **Horological Dictionary:** A comprehensive, searchable database of watchmaking terminology (e.g., Tourbillons, Minute Repeaters, Perpetual Calendars) with detailed historical context and signatures.
* **Accessible & Performant:** Implements strict `prefers-reduced-motion` compliance, WebGL fallback state machines, and optimized atomic asset loading for seamless cross-device performance.

## 🛠 Tech Stack
| Category | Technology |
| :--- | :--- |
| **Core Framework** | Next.js (App Router), React, TypeScript |
| **3D Rendering** | Three.js, React Three Fiber, `@react-three/drei` |
| **Animations** | Framer Motion |
| **Styling** | Tailwind CSS, Custom CSS properties |
| **Deployment** | Vercel (CI/CD) |

## 📂 Project Architecture
* `app/`: Next.js App Router pages, static fallback definitions, and global layout shells.
* `components/canvas/`: WebGL boundary components, camera choreography, and 3D movement scenes.
* `components/ui/`: Interactive UI layers, including the Node Graph engine, Search Bar, and Definition Panels.
* `lib/`: Core application logic, including the spatial graph engine, active-time animation semantics, and deterministic search algorithms.
* `data/`: Immutable JSON databases housing brand inventories, terminology, and 3D asset metadata.