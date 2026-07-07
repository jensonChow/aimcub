import {
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import "./primitives.css";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";
type Tone = "neutral" | "accent" | "success" | "warn" | "danger";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  selected?: boolean;
}

export function Button({
  className,
  variant = "secondary",
  size = "md",
  selected = false,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={cx("od-ui-button", className)}
      data-variant={variant}
      data-size={size}
      data-selected={selected ? "true" : undefined}
    />
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  selected?: boolean;
}

export function IconButton({
  className,
  variant = "secondary",
  size = "md",
  selected = false,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={cx("od-ui-icon-button", className)}
      data-variant={variant}
      data-size={size}
      data-selected={selected ? "true" : undefined}
    />
  );
}

interface FieldChromeProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
}

function fieldDescriptionId(id: string, hint: ReactNode, error: ReactNode): string | undefined {
  const ids = [];
  if (hint) ids.push(`${id}-hint`);
  if (error) ids.push(`${id}-error`);
  return ids.length ? ids.join(" ") : undefined;
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size">, FieldChromeProps {}

export function TextField({
  className,
  fieldClassName,
  label,
  hint,
  error,
  id,
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = props["aria-describedby"] ?? fieldDescriptionId(inputId, hint, error);
  return (
    <label className={cx("od-ui-field", fieldClassName)} data-invalid={error ? "true" : undefined}>
      {label ? <span className="od-ui-field-label">{label}</span> : null}
      <input {...props} id={inputId} aria-describedby={describedBy} className={cx("od-ui-input", className)} />
      {hint ? <span id={`${inputId}-hint`} className="od-ui-field-hint">{hint}</span> : null}
      {error ? <span id={`${inputId}-error`} className="od-ui-field-error">{error}</span> : null}
    </label>
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldChromeProps {}

export function TextArea({
  className,
  fieldClassName,
  label,
  hint,
  error,
  id,
  ...props
}: TextAreaProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = props["aria-describedby"] ?? fieldDescriptionId(inputId, hint, error);
  return (
    <label className={cx("od-ui-field", fieldClassName)} data-invalid={error ? "true" : undefined}>
      {label ? <span className="od-ui-field-label">{label}</span> : null}
      <textarea {...props} id={inputId} aria-describedby={describedBy} className={cx("od-ui-textarea", className)} />
      {hint ? <span id={`${inputId}-hint`} className="od-ui-field-hint">{hint}</span> : null}
      {error ? <span id={`${inputId}-error`} className="od-ui-field-error">{error}</span> : null}
    </label>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, FieldChromeProps {}

export function Select({
  className,
  fieldClassName,
  label,
  hint,
  error,
  id,
  children,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = props["aria-describedby"] ?? fieldDescriptionId(inputId, hint, error);
  return (
    <label className={cx("od-ui-field", fieldClassName)} data-invalid={error ? "true" : undefined}>
      {label ? <span className="od-ui-field-label">{label}</span> : null}
      <select {...props} id={inputId} aria-describedby={describedBy} className={cx("od-ui-select", className)}>
        {children}
      </select>
      {hint ? <span id={`${inputId}-hint`} className="od-ui-field-hint">{hint}</span> : null}
      {error ? <span id={`${inputId}-error`} className="od-ui-field-error">{error}</span> : null}
    </label>
  );
}

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Pill({ className, tone = "neutral", ...props }: PillProps) {
  return <span {...props} className={cx("od-ui-pill", className)} data-tone={tone} />;
}

type PanelElement = "section" | "article" | "div";

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: PanelElement;
  variant?: "surface" | "warm" | "plain";
  tone?: Tone;
}

export function Panel({
  as: Element = "section",
  className,
  variant = "surface",
  tone = "neutral",
  ...props
}: PanelProps) {
  return <Element {...props} className={cx("od-ui-panel", className)} data-variant={variant} data-tone={tone} />;
}

export interface RowProps extends HTMLAttributes<HTMLDivElement> {
  trailing?: ReactNode;
  variant?: "plain" | "surface";
}

export function Row({ className, children, trailing, variant = "plain", ...props }: RowProps) {
  return (
    <div {...props} className={cx("od-ui-row", className)} data-variant={variant}>
      <div className="od-ui-row-main">{children}</div>
      {trailing ? <div className="od-ui-row-trailing">{trailing}</div> : null}
    </div>
  );
}

export interface MetricProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
}

export function Metric({ className, label, value, ...props }: MetricProps) {
  return (
    <div {...props} className={cx("od-ui-metric", className)}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
}

export function EmptyState({ className, title, body, actions, ...props }: EmptyStateProps) {
  return (
    <div {...props} className={cx("od-ui-empty-state", className)}>
      <div className="od-ui-empty-state-inner">
        <h3>{title}</h3>
        {body ? <p>{body}</p> : null}
        {actions ? <div className="od-ui-empty-state-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
