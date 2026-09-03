/**
 * GET /api/og
 *
 * Dynamic Open Graph image generator.
 * Returns a 1200×630 PNG card for any character or page.
 *
 * Query params:
 *   title — display title (required)
 *   image — character image URL to embed (optional)
 *   sub   — subtitle / description line (optional)
 *
 * Used by characterOgImageUrl() in src/lib/seo/meta.ts.
 * Cache-Control: 7 days (characters don't change often).
 *
 * Uses @vercel/og (ImageResponse) — Edge Runtime only.
 */

import { ImageResponse } from "next/og";
import { NextRequest }   from "next/server";
export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const title = searchParams.get("title") ?? "Vantrix Ai";
  const image = searchParams.get("image") ?? null;
  const sub   = searchParams.get("sub")   ?? "AI Companion Platform";

  // Sanitise — prevent XSS in SVG context
  const safeTitle = title.slice(0, 60).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeSub   = sub.slice(0, 120).replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return new ImageResponse(
    (
      <div
        style={{
          display:         "flex",
          width:           "1200px",
          height:          "630px",
          background:      "linear-gradient(135deg, #050510 0%, #0B0B1D 50%, #0D0720 100%)",
          position:        "relative",
          fontFamily:      "system-ui, -apple-system, sans-serif",
          overflow:        "hidden",
        }}
      >
        {/* Background glow orbs */}
        <div style={{
          position: "absolute", width: "600px", height: "600px",
          left: "-200px", top: "-200px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(251, 113, 133,0.35) 0%, transparent 70%)",
          filter: "blur(80px)", display: "flex",
        }} />
        <div style={{
          position: "absolute", width: "500px", height: "500px",
          right: "-100px", bottom: "-150px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,63,159,0.3) 0%, transparent 70%)",
          filter: "blur(80px)", display: "flex",
        }} />

        {/* Left: text content */}
        <div style={{
          display:        "flex",
          flexDirection:  "column",
          justifyContent: "center",
          padding:        "64px 60px",
          flex:           1,
          zIndex:         2,
          gap:            "20px",
        }}>
          {/* Brand */}
          <div style={{
            display:      "flex",
            alignItems:   "center",
            gap:          "10px",
            marginBottom: "8px",
          }}>
            <div style={{
              fontSize:     "13px",
              fontWeight:   "700",
              letterSpacing:"0.3em",
              textTransform:"uppercase",
              color:        "#FF6B35",
            }}>
              VANTRIX
            </div>
            <div style={{
              width: "1px", height: "14px",
              background: "rgba(255,255,255,0.2)",
              display: "flex",
            }} />
            <div style={{
              fontSize: "12px", color: "rgba(255,255,255,0.4)",
              letterSpacing: "0.1em",
            }}>
              AI COMPANIONS
            </div>
          </div>

          {/* Title */}
          <div style={{
            fontSize:     safeTitle.length > 30 ? "52px" : "64px",
            fontWeight:   "300",
            color:        "#F0EBFF",
            lineHeight:   "1.1",
            letterSpacing:"-0.02em",
            maxWidth:     image ? "560px" : "900px",
          }}>
            {safeTitle}
          </div>

          {/* Subtitle */}
          <div style={{
            fontSize:   "20px",
            color:      "rgba(255,255,255,0.45)",
            fontWeight: "300",
            maxWidth:   "500px",
            lineHeight: "1.5",
          }}>
            {safeSub}
          </div>

          {/* CTA badge */}
          <div style={{
            display:       "flex",
            alignItems:    "center",
            gap:           "8px",
            marginTop:     "16px",
          }}>
            <div style={{
              background:    "linear-gradient(135deg, #FF6B35, #FF3F9F)",
              borderRadius:  "100px",
              padding:       "10px 24px",
              fontSize:      "14px",
              fontWeight:    "600",
              color:         "#fff",
              display:       "flex",
              letterSpacing: "0.03em",
            }}>
              Start Chatting Free
            </div>
            <div style={{
              fontSize:  "13px",
              color:     "rgba(255,255,255,0.35)",
              display:   "flex",
              alignItems:"center",
              gap:       "6px",
            }}>
              <span style={{ display: "flex" }}>🇳🇬</span>
              <span style={{ display: "flex" }}>🇰🇪</span>
            </div>
          </div>
        </div>

        {/* Right: character image */}
        {image && (
          <div style={{
            display:        "flex",
            alignItems:     "flex-end",
            justifyContent: "center",
            width:          "340px",
            position:       "relative",
            overflow:       "hidden",
          }}>
            {/* Gradient fade on left edge */}
            <div style={{
              position:   "absolute",
              left:       0, top: 0, bottom: 0,
              width:      "120px",
              background: "linear-gradient(to right, #050510, transparent)",
              zIndex:     3,
              display:    "flex",
            }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt={safeTitle}
              style={{
                height:     "100%",
                width:      "100%",
                objectFit:  "cover",
                objectPosition: "top center",
              }}
            />
          </div>
        )}

        {/* Vantrix.ink watermark */}
        <div style={{
          position:   "absolute",
          bottom:     "28px",
          right:      "40px",
          fontSize:   "13px",
          color:      "rgba(255,255,255,0.2)",
          letterSpacing: "0.05em",
          display:    "flex",
        }}>
          vantrix.ink
        </div>
      </div>
    ),
    {
      width:  1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400",
        "Content-Type":  "image/png",
      },
    },
  );
}
