import { EliteWatchesExperience } from "@/components/EliteWatchesExperience";
import { dictionaryTerms } from "@/lib/dictionary";

export default function HomePage() {
  return <EliteWatchesExperience terms={dictionaryTerms} />;
}
