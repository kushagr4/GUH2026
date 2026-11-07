"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  REPORT_DESCRIPTION_LENGTH,
  REPORT_MEDIA_BUCKET,
  reportMediaObjectPath,
  reportSubmissionResponseSchema,
} from "@/lib/embergap/contracts";
import { createClient } from "@/lib/supabase/client";
import { reencodePhoto } from "./photo";
import {
  DEFAULT_UNCERTAINTY_METERS,
  DESCRIPTION_WARNING_RATIO,
  GEOLOCATION_DECIMALS,
  UNCERTAINTY_OPTIONS,
  SERVICE_AREA,
  VALIDATED_FIELDS,
  buildReportRequest,
  mapApiError,
  roundTo,
  toDateTimeLocalValue,
  validateReportField,
  type ReportField,
  type ReportFieldErrors,
  type ReportFormValues,
  type ValidatedField,
} from "./report-request";

/** Ids for one submission, kept across retries until a 2xx response. */
type Submission = { clientRequestId: string; mediaId: string | null; uploaded: boolean };

const fieldId = (name: ReportField) => `report-${name}`;
const errorId = (name: ReportField) => `report-${name}-error`;

/** Order the error summary and focus follow; "location" problems are fixed in the latitude box. */
const FOCUS_ORDER: ReportField[] = ["latitude", "longitude", "location", "uncertaintyMeters", "observedAt", "description", "media"];
const focusTarget = (name: ReportField): string => fieldId(name === "location" ? "latitude" : name);

/** Fields whose inline message depends on each input (coordinates also drive the service-area check). */
const AFFECTS: Record<"latitude" | "longitude" | "uncertaintyMeters" | "observedAt" | "description", ValidatedField[]> = {
  latitude: ["latitude", "location"],
  longitude: ["longitude", "location"],
  uncertaintyMeters: ["uncertaintyMeters"],
  observedAt: ["observedAt"],
  description: ["description"],
};

function FieldError({ name, errors }: { name: ReportField; errors: ReportFieldErrors }) {
  const message = errors[name];
  if (!message) return null;
  return (
    <p id={errorId(name)} className="text-sm text-destructive">
      {message}
    </p>
  );
}

function isAlreadyExists(error: { message?: string; statusCode?: string | number } | null): boolean {
  if (!error) return false;
  return String(error.statusCode ?? "") === "409" || /already exists|duplicate/i.test(error.message ?? "");
}

export function ReportForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [uncertaintyMeters, setUncertaintyMeters] = useState(DEFAULT_UNCERTAINTY_METERS);
  const [observedAtLocal, setObservedAtLocal] = useState(() => toDateTimeLocalValue(new Date()));
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<ValidatedField, boolean>>>({});
  const [triedToSend, setTriedToSend] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ReportFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const submissionRef = useRef<Submission | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function describedBy(name: ReportField, hint?: string) {
    return [hint, fieldErrors[name] ? errorId(name) : undefined].filter(Boolean).join(" ") || undefined;
  }

  const currentValues = (): ReportFormValues => ({ latitude, longitude, uncertaintyMeters, observedAtLocal, description });

  /** Re-checks the given fields against `values`; only fields already touched (or showing an error) change. */
  function refresh(fields: ValidatedField[], values: ReportFormValues, force = false) {
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const field of fields) {
        if (!force && !touched[field] && !prev[field]) continue;
        next[field] = validateReportField(field, values);
      }
      return next;
    });
  }

  /** Validate on blur: the field (and anything it drives) becomes "touched". */
  function handleBlur(input: keyof typeof AFFECTS) {
    const fields = AFFECTS[input];
    setTouched((prev) => ({ ...prev, ...Object.fromEntries(fields.map((field) => [field, true])) }));
    refresh(fields, currentValues(), true);
  }

  /** After the first error, re-validate as the user types so the message clears as soon as it's fixed. */
  function handleChange(input: keyof typeof AFFECTS, patch: Partial<ReportFormValues>) {
    refresh(AFFECTS[input], { ...currentValues(), ...patch });
  }

  function handleUseLocation() {
    setLocationNote(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationNote("Your browser can't share a location. Enter the latitude and longitude instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(String(roundTo(position.coords.latitude, GEOLOCATION_DECIMALS)));
        setLongitude(String(roundTo(position.coords.longitude, GEOLOCATION_DECIMALS)));
        setFieldErrors((prev) => ({ ...prev, latitude: undefined, longitude: undefined, location: undefined }));
        setLocationNote("Filled in your approximate position. Adjust it towards where you saw the smoke if you can.");
        setLocating(false);
      },
      (error) => {
        setLocationNote(
          error.code === error.PERMISSION_DENIED
            ? "Location access was denied. Enter the latitude and longitude instead."
            : "We couldn't get your location. Enter the latitude and longitude instead.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function clearPhoto() {
    setPhoto(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (submissionRef.current) submissionRef.current = { ...submissionRef.current, mediaId: null, uploaded: false };
  }

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setFieldErrors((prev) => ({ ...prev, media: undefined }));
    if (!file) return;
    setPhotoBusy(true);
    const result = await reencodePhoto(file);
    setPhotoBusy(false);
    if (!result.ok) {
      clearPhoto();
      setFieldErrors((prev) => ({ ...prev, media: result.message }));
      return;
    }
    setPhoto(result.blob);
    setPreviewUrl(URL.createObjectURL(result.blob));
    // A different photo needs its own Storage object.
    if (submissionRef.current) submissionRef.current = { ...submissionRef.current, mediaId: null, uploaded: false };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;

    const submission: Submission = submissionRef.current ?? {
      clientRequestId: crypto.randomUUID(),
      mediaId: null,
      uploaded: false,
    };
    if (photo && !submission.mediaId) submission.mediaId = crypto.randomUUID();
    if (!photo) {
      submission.mediaId = null;
      submission.uploaded = false;
    }
    submissionRef.current = submission;

    const built = buildReportRequest(
      { latitude, longitude, uncertaintyMeters, observedAtLocal, description },
      {
        clientRequestId: submission.clientRequestId,
        media: submission.mediaId ? { mediaId: submission.mediaId, mimeType: "image/jpeg" } : null,
      },
    );
    if (!built.ok) {
      setFieldErrors(built.fieldErrors);
      setTouched(Object.fromEntries(VALIDATED_FIELDS.map((field) => [field, true])));
      setTriedToSend(true);
      setFormError(null);
      const first = FOCUS_ORDER.find((field) => built.fieldErrors[field]);
      if (first) document.getElementById(focusTarget(first))?.focus();
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    try {
      if (photo && submission.mediaId && !submission.uploaded) {
        const { error } = await createClient()
          .storage.from(REPORT_MEDIA_BUCKET)
          .upload(reportMediaObjectPath(userId, submission.mediaId, "image/jpeg"), photo, {
            contentType: "image/jpeg",
            upsert: false,
          });
        if (error && !isAlreadyExists(error)) {
          setFormError("We couldn't upload the photo. Check your connection and try again, or remove the photo.");
          return;
        }
        submission.uploaded = true;
      }

      let response: Response;
      try {
        response = await fetch("/api/embergap/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(built.data),
        });
      } catch {
        setFormError("We couldn't reach EmberGap. Check your connection and try again; your report won't be duplicated.");
        return;
      }

      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const parsed = reportSubmissionResponseSchema.safeParse(body);
        if (!parsed.success) {
          setFormError("We couldn't confirm your report. Try again; it won't be duplicated.");
          return;
        }
        submissionRef.current = null;
        router.push(`/app/embergap/investigations/${parsed.data.investigationId}`);
        return;
      }

      const mapped = mapApiError(response.status, body);
      if (mapped.retry === "new_media" && submissionRef.current) {
        submissionRef.current = { ...submissionRef.current, mediaId: null, uploaded: false };
      }
      setFieldErrors(mapped.fieldErrors);
      setFormError(mapped.message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const busy = submitting || photoBusy;
  /** Problems shown in the summary once the user has tried to send (every validated field is touched then). */
  const summary = (triedToSend ? FOCUS_ORDER : []).filter((field) => fieldErrors[field]).map(
    (field) => [field, fieldErrors[field]!] as const,
  );

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6" aria-busy={submitting}>
      {summary.length > 0 ? (
        <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm">
          <p className="font-semibold text-destructive">
            {summary.length === 1 ? "1 thing needs fixing" : `${summary.length} things need fixing`} before you send:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {summary.map(([field, message]) => (
              <li key={field}>
                <a
                  href={`#${focusTarget(field)}`}
                  className="underline underline-offset-2"
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(focusTarget(field))?.focus();
                  }}
                >
                  {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-base font-semibold">Where did you see it?</legend>
        <p id="report-location-hint" className="text-sm text-muted-foreground">
          Mark roughly where the smoke or fire is, not where you are standing. Reports are accepted for {SERVICE_AREA.name}{" "}
          only during this demo. Investigators see this point; anyone else only sees an area of about 1 km or more.
        </p>
        <div>
          <Button type="button" variant="outline" onClick={handleUseLocation} disabled={locating || submitting}>
            {locating ? "Finding your location…" : "Use my approximate location"}
          </Button>
          {locationNote ? (
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              {locationNote}
            </p>
          ) : null}
        </div>
        <p className="text-sm font-medium">Or enter coordinates</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("latitude")}>Latitude</Label>
            <Input
              id={fieldId("latitude")}
              inputMode="decimal"
              autoComplete="off"
              placeholder={`e.g. ${SERVICE_AREA.example.latitude}`}
              value={latitude}
              onChange={(e) => {
                setLatitude(e.target.value);
                handleChange("latitude", { latitude: e.target.value });
              }}
              onBlur={() => handleBlur("latitude")}
              aria-invalid={Boolean(fieldErrors.latitude)}
              aria-describedby={describedBy("latitude", "report-location-hint")}
            />
            <FieldError name="latitude" errors={fieldErrors} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("longitude")}>Longitude</Label>
            <Input
              id={fieldId("longitude")}
              inputMode="decimal"
              autoComplete="off"
              placeholder={`e.g. ${SERVICE_AREA.example.longitude}`}
              value={longitude}
              onChange={(e) => {
                setLongitude(e.target.value);
                handleChange("longitude", { longitude: e.target.value });
              }}
              onBlur={() => handleBlur("longitude")}
              aria-invalid={Boolean(fieldErrors.longitude)}
              aria-describedby={describedBy("longitude", "report-location-hint")}
            />
            <FieldError name="longitude" errors={fieldErrors} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fieldId("uncertaintyMeters")}>How sure are you of that point?</Label>
          <select
            id={fieldId("uncertaintyMeters")}
            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-base sm:w-60 md:text-sm"
            value={uncertaintyMeters}
            onChange={(e) => {
              setUncertaintyMeters(Number(e.target.value));
              handleChange("uncertaintyMeters", { uncertaintyMeters: Number(e.target.value) });
            }}
            onBlur={() => handleBlur("uncertaintyMeters")}
            aria-invalid={Boolean(fieldErrors.uncertaintyMeters)}
            aria-describedby={describedBy("uncertaintyMeters")}
          >
            {UNCERTAINTY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldError name="uncertaintyMeters" errors={fieldErrors} />
          <FieldError name="location" errors={fieldErrors} />
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId("observedAt")}>When did you see it?</Label>
        <Input
          id={fieldId("observedAt")}
          type="datetime-local"
          className="sm:w-60"
          value={observedAtLocal}
          max={toDateTimeLocalValue(new Date())}
          onChange={(e) => {
            setObservedAtLocal(e.target.value);
            handleChange("observedAt", { observedAtLocal: e.target.value });
          }}
          onBlur={() => handleBlur("observedAt")}
          aria-invalid={Boolean(fieldErrors.observedAt)}
          aria-describedby={describedBy("observedAt", "report-observedAt-hint")}
        />
        <p id="report-observedAt-hint" className="text-sm text-muted-foreground">
          Your local time. Within the last 72 hours.
        </p>
        <FieldError name="observedAt" errors={fieldErrors} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId("description")}>What did you see?</Label>
        <Textarea
          id={fieldId("description")}
          rows={4}
          maxLength={REPORT_DESCRIPTION_LENGTH.max}
          placeholder="e.g. Grey smoke rising from the vineyard slope above Terzigno, drifting east and getting thicker over 10 minutes."
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            handleChange("description", { description: e.target.value });
          }}
          onBlur={() => handleBlur("description")}
          aria-invalid={Boolean(fieldErrors.description)}
          aria-describedby={describedBy("description", "report-description-hint")}
        />
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p id="report-description-hint" className="text-sm text-muted-foreground">
            At least {REPORT_DESCRIPTION_LENGTH.min} characters. Smoke colour, size, direction (towards the vines, a road,
            houses) and how it changed all help.
          </p>
          <p
            className={
              description.trim().length >= REPORT_DESCRIPTION_LENGTH.max * DESCRIPTION_WARNING_RATIO
                ? "text-xs font-medium text-amber-600 dark:text-amber-400"
                : "text-xs text-muted-foreground"
            }
            aria-live="polite"
          >
            {description.trim().length.toLocaleString("en-GB")} / {REPORT_DESCRIPTION_LENGTH.max.toLocaleString("en-GB")}
          </p>
        </div>
        <FieldError name="description" errors={fieldErrors} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId("media")}>Photo (optional)</Label>
        <Input
          ref={fileInputRef}
          id={fieldId("media")}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handlePhoto}
          disabled={busy}
          aria-invalid={Boolean(fieldErrors.media)}
          aria-describedby={describedBy("media", "report-media-hint")}
        />
        <p id="report-media-hint" className="text-sm text-muted-foreground">
          Only take a photo from where you already are. We remove location and camera data before upload, and the
          photo stays private to you and investigators.
        </p>
        {photoBusy ? (
          <p className="text-sm text-muted-foreground" role="status">
            Preparing photo…
          </p>
        ) : null}
        <FieldError name="media" errors={fieldErrors} />
        {previewUrl ? (
          <div className="flex flex-col items-start gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, not an optimisable asset */}
            <img src={previewUrl} alt="Preview of the photo you chose" className="max-h-64 max-w-full rounded-lg border object-contain" />
            <Button type="button" variant="outline" size="sm" onClick={clearPhoto} disabled={submitting}>
              Remove photo
            </Button>
          </div>
        ) : null}
      </div>

      {formError ? <FormMessage variant="error">{formError}</FormMessage> : null}

      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={busy} className="w-full sm:w-auto sm:self-start">
          {submitting ? "Sending report…" : "Send report"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Your report is a claim, not a confirmed fire. It stays unverified until a person reviews the evidence.
        </p>
      </div>
    </form>
  );
}
