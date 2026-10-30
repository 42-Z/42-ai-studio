import { ArrowRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

// Временная главная. Заменит #33.
export default function HomePage() {
  return (
    <section className="flex w-full flex-col items-center gap-6 text-center">
      <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
        42 AI Studio
      </h1>
      <Button render={<a href="/s" />} nativeButton={false} size="lg">
        Открыть
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
    </section>
  );
}
