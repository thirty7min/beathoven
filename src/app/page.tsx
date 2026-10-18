import { HeroBackdrop } from "@/components/hero-backdrop";
import { HomeScreen } from "@/components/home/home-screen";

export default function Home() {
  return (
    <main className="relative isolate flex flex-1 items-center justify-center overflow-hidden px-4 py-16">
      <HeroBackdrop />
      <HomeScreen />
    </main>
  );
}
