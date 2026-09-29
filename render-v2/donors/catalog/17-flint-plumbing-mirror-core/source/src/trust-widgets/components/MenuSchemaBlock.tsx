import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { offerCatalog } from "../seo/jsonld";
import { JsonLd } from "./primitives";

/**
 * Visible priced table + matching OfferCatalog JSON-LD.
 * Schema is emitted only alongside the rendered rows, so it can never outrun the DOM.
 */
export function MenuSchemaBlock({ emitSchema = true }: { emitSchema?: boolean }) {
  const cfg = useTrust();
  const rows = (cfg.services ?? []).filter((s) => s.priceFrom);
  return (
    <Gate id="MenuSchemaBlock" when={rows.length > 0}>
      <div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".92rem" }}>
          <caption className="tw-eyebrow" style={{ textAlign: "left", captionSide: "top" }}>{cfg.labels.serviceMenuTitle}</caption>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "left", padding: ".6rem 0", borderBottom: "1px solid var(--tw-line)" }}>Service</th>
              <th scope="col" style={{ textAlign: "right", padding: ".6rem 0", borderBottom: "1px solid var(--tw-line)" }}>Starting price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <th scope="row" style={{ textAlign: "left", fontWeight: 400, padding: ".55rem 0", borderBottom: "1px solid var(--tw-line)" }}>
                  {s.name}
                  {s.description ? <span className="tw-muted"> — {s.description}</span> : null}
                </th>
                <td style={{ textAlign: "right", padding: ".55rem 0", borderBottom: "1px solid var(--tw-line)" }}>
                  ${s.priceFrom}{s.priceTo ? `–$${s.priceTo}` : "+"}{s.priceUnit ? ` ${s.priceUnit}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {emitSchema ? <JsonLd data={{ "@context": "https://schema.org", ...offerCatalog(cfg) }} /> : null}
      </div>
    </Gate>
  );
}
