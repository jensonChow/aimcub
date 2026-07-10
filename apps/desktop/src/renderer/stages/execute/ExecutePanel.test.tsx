import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { executeTaskContent } from "./ExecutePanel";

describe("ExecutePanel focused task flow", () => {
  it("places the selected task before secondary runtime and activity details", () => {
    const panelSource = readFileSync(new URL("./ExecutePanel.tsx", import.meta.url), "utf8");
    const summarySource = readFileSync(new URL("./LocalAgentExecutionSummary.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../cockpit.css", import.meta.url), "utf8");
    const basicStateIndex = summarySource.indexOf('className="od-execution-grid"');
    const taskIndex = summarySource.indexOf('{props.task ? <div className="od-execute-task">');
    const detailsIndex = summarySource.indexOf('<details className="od-execution-secondary-details">');

    expect(basicStateIndex).toBeGreaterThan(-1);
    expect(taskIndex).toBeGreaterThan(basicStateIndex);
    expect(detailsIndex).toBeGreaterThan(taskIndex);
    expect(panelSource).toContain("const proofIsActive = Boolean(selectedRow && activeProofId === selectedRow.milestone.id);");
    expect(panelSource).toContain("task={executeTaskContent(proofIsActive ? (");
    expect(css).toMatch(/\.od-execute-selector\s*{[^}]*max-height:\s*320px;[^}]*overflow:\s*auto;/s);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.od-execute-selector\s*{[^}]*max-height:\s*116px;[^}]*overflow:\s*auto;/s);
  });

  it("replaces the normal primary and secondary actions while proof is active", () => {
    const proofHtml = renderToStaticMarkup(
      <>
        {executeTaskContent(
          <form className="od-proof-form">
            <button type="submit">Submit current proof</button>
          </form>,
          <>
            <div className="od-execute-primary-action">
              <button className="od-execute-primary-button" type="button">Run agent</button>
            </div>
            <div className="od-execute-secondary-actions">
              <button className="od-aim-secondary" type="button">Break down</button>
            </div>
          </>,
        )}
      </>,
    );
    const actionsHtml = renderToStaticMarkup(
      <>
        {executeTaskContent(null, (
          <>
            <div className="od-execute-primary-action">
              <button className="od-execute-primary-button" type="button">Run agent</button>
            </div>
            <div className="od-execute-secondary-actions">
              <button className="od-aim-secondary" type="button">Break down</button>
            </div>
          </>
        ))}
      </>,
    );

    expect(proofHtml).toContain('class="od-proof-form"');
    expect(proofHtml).toContain("Submit current proof");
    expect(proofHtml).not.toContain("od-execute-primary-action");
    expect(proofHtml).not.toContain("od-execute-secondary-actions");
    expect(actionsHtml).toContain("od-execute-primary-action");
    expect(actionsHtml).toContain("od-execute-secondary-actions");
  });

  it("keeps a failed proof submission open and hands focus across the proof task", () => {
    const panelSource = readFileSync(new URL("./ExecutePanel.tsx", import.meta.url), "utf8");
    const formSource = readFileSync(new URL("./EvidenceSubmissionForm.tsx", import.meta.url), "utf8");

    expect(panelSource).toContain("const confirmed = await props.onConfirm");
    expect(panelSource).toContain("if (!confirmed) return;");
    expect(panelSource).toMatch(/function openProof[\s\S]*?setSelectedMilestoneId\(milestone\.id\);[\s\S]*?setActiveProofId\(milestone\.id\);/);
    expect(panelSource).toContain("props.onProofDraftActiveChange?.(true);");
    expect(panelSource).toContain("props.onProofDraftActiveChange?.(false);");
    expect(panelSource).toContain("proofTriggerRef.current?.focus();");
    expect(formSource).toContain("autoFocus");
  });
});
