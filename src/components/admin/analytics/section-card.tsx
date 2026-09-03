import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";

export function SectionCard({
  title,
  subtitle,
  href,
  hrefLabel = "View all",
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card interactive={false} className={`p-5 ${className ?? ""}`}>
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h3 className="text-sm font-medium text-text-primary">{title}</h3>
          {subtitle && <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>}
        </div>
        {href && (
          <Link
            href={href}
            className="flex items-center gap-0.5 text-xs text-text-tertiary hover:text-gold-400 transition-colors ease-premium duration-150 shrink-0"
          >
            {hrefLabel}
            <ChevronRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        )}
      </div>
      {children}
    </Card>
  );
}
