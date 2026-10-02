"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { dashboardStatus, sortDashboardPlatforms, statusLabels, type DashboardSort, type Platform } from "../lib/status";

import { usePlatforms, savePlatforms } from "../lib/use-platforms";
import { healthUrl } from "../lib/health-url";
import { uptimeSummary } from "../lib/uptime";
import { RecentIncidents } from "./recent-incidents";

function hostnameFromInput(value: string) {
  const candidate = value.trim();

  if (!candidate || /\s/.test(candidate)) {
    return null;
  }

  try {
    const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    return url.hostname.includes(".") ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function instanceUrlFromInput(value: string) {
  const candidate = value.trim();

  if (!candidate || /\s/.test(candidate)) {
    return null;
  }

  try {
    const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    return url.hostname.includes(".") ? url.href.replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

export default function Dashboard() {
  const { platforms: createdPlatforms, setPlatforms: setCreatedPlatforms, error } = usePlatforms();
  const [healthPaths, setHealthPaths] = useState([""]);
  const [saving, setSaving] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [platformName, setPlatformName] = useState("");
  const [instances, setInstances] = useState([""]);
  const [formError, setFormError] = useState("");
  const [sort, setSort] = useState<DashboardSort>("status");

  const closeDialog = () => {
    setIsDialogOpen(false);
    setPlatformName("");
    setInstances([""]);
    setHealthPaths([""]);
    setFormError("");
  };

  useEffect(() => {
    if (!isDialogOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDialog();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isDialogOpen]);

  const updateInstance = (index: number, value: string) => {
    setInstances((current) =>
      current.map((instance, instanceIndex) =>
        instanceIndex === index ? value : instance,
      ),
    );
  };

  const removeInstance = (index: number) => {
    setHealthPaths((current) => current.filter((_, instanceIndex) => instanceIndex !== index));
    setInstances((current) => current.filter((_, instanceIndex) => instanceIndex !== index));
  };

  const createPlatform = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const hostname = hostnameFromInput(platformName);
    const normalizedInstances = instances.map(instanceUrlFromInput);

    if (!hostname) {
      setFormError("Enter a valid platform domain, such as example.com.");
      return;
    }

    if (normalizedInstances.some((instance) => !instance)) {
      setFormError("Enter a valid URL or hostname for every instance.");
      return;
    }

    if (new Set(normalizedInstances).size !== normalizedInstances.length) {
      setFormError("Each instance URL must be unique.");
      return;
    }

    if (createdPlatforms.some((platform) => platform.name === hostname)) {
      setFormError("That platform already exists.");
      return;
    }

    let healthUrls: Record<string, string>;
    try {
      healthUrls = Object.fromEntries(normalizedInstances.map((instance, index) => [instance!, healthUrl(instance!, healthPaths[index])]));
    } catch {
      setFormError("Enter an HTTP(S) health-check URL or a path such as /health.");
      return;
    }

    const platform: Platform = {
      id: crypto.randomUUID(),
      name: hostname,
      instances: normalizedInstances as string[],
      healthUrls,
    };
    setSaving(true);
    try {
      setCreatedPlatforms(await savePlatforms([platform]));
      closeDialog();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to save platform.");
    } finally { setSaving(false); }
  };

  const platforms = sortDashboardPlatforms(createdPlatforms, sort);

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <Link className="dashboard-brand" href="/dashboard" aria-label="Nighthawk dashboard">
          <span className="dashboard-brand-mark" aria-hidden="true">N</span>
          <span>Nighthawk</span>
        </Link>
        <button className="create-platform-button" onClick={() => setIsDialogOpen(true)} type="button">
          <span aria-hidden="true">+</span>
          Create platform
        </button>
      </header>

      <div className="dashboard-content">
        <section className="platforms" aria-labelledby="platforms-heading">
          <div className="platforms-heading">
            <div>
              <h1 id="platforms-heading">Platforms</h1>
              <p>Monitor your deployed sites and their instances.</p>
            </div>
            <span>{platforms.length} total</span>
          </div>
          <div className="platform-sort">
            <label htmlFor="platform-sort">Sort by</label>
            <select
              id="platform-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value === "status" ? "status" : "alphabetical")}
            >
              <option value="alphabetical">Alphabetical (A–Z)</option>
              <option value="status">Status (worst first)</option>
            </select>
          </div>
          <p className="status-legend">Green: successful check · Amber: all instances were offline in this window, now recovered · Red: all instances offline · Gray: unchecked</p>
          <p className="status-note">Health checks run every 10 seconds. HTTP 2xx responses are healthy.</p>
          <p className="status-note">Uptime is the share of checks that succeeded in the last 30 days. Unknown results are not counted.</p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="platform-grid" aria-label="Platform status overview">
            {platforms.map((platform) => (
              <article className="platform-card-container" key={platform.id}>
                <Link
                  aria-label={`View instances for ${platform.name}`}
                  className="platform-card"
                  href={`/instances/${encodeURIComponent(platform.id)}`}
                >
                  <div
                    aria-label={`${platform.name}: ${statusLabels[dashboardStatus(platform)]}`}
                    className={`platform-tile platform-tile--${dashboardStatus(platform)}`}
                    role="img"
                  />
                  <h2>{platform.name}</h2>
                  <p>
                    {platform.instances.length
                      ? `${platform.instances.length} ${platform.instances.length === 1 ? "instance" : "instances"}`
                      : "No instances"}
                  </p>
                  {(() => { const uptime = uptimeSummary(platform.platformUptime, Date.now()); return (
                    <p className={`platform-uptime platform-uptime--${uptime.meetsTarget === null ? "none" : uptime.meetsTarget ? "ok" : "below"}`} title={uptime.coverage}>
                      {uptime.label}{uptime.coverage ? ` ${uptime.coverage}` : ""}{uptime.provisional ? " · provisional" : ""}
                    </p>
                  ); })()}
                </Link>
              </article>
            ))}
          </div>
        </section>
        <RecentIncidents platforms={createdPlatforms} error={error} />
      </div>

      {isDialogOpen ? (
        <div className="dialog-backdrop" onMouseDown={(event) => {
          if (event.currentTarget === event.target) closeDialog();
        }}>
          <section
            aria-labelledby="create-platform-heading"
            aria-modal="true"
            className="platform-dialog"
            role="dialog"
          >
            <div className="dialog-heading">
              <div>
                <p className="dialog-eyebrow">New platform</p>
                <h2 id="create-platform-heading">Create a platform</h2>
              </div>
              <button aria-label="Close dialog" className="dialog-close" onClick={closeDialog} type="button">
                ×
              </button>
            </div>
            <p className="dialog-description">
              A platform groups the deployed instances that serve the same site.
            </p>

            <form className="platform-form" onSubmit={createPlatform}>
              <label htmlFor="platform-domain">Platform domain</label>
              <input
                autoFocus
                id="platform-domain"
                onChange={(event) => setPlatformName(event.target.value)}
                placeholder="example.com"
                type="text"
                value={platformName}
              />

              <div className="instance-field-heading">
                <label htmlFor="instance-0">Instances</label>
                <button
                  className="add-instance-button"
                  onClick={() => { setInstances((current) => [...current, ""]); setHealthPaths((current) => [...current, ""]); }}
                  type="button"
                >
                  + Add instance
                </button>
              </div>
              <p className="field-hint">Add each deployment URL and an optional health-check path or full URL. Leave blank to check the deployment URL.</p>

              <div className="instance-fields">
                {instances.map((instance, index) => (
                  <div className="instance-field" key={index}>
                    <input
                      aria-label={`Instance ${index + 1} URL`}
                      id={`instance-${index}`}
                      onChange={(event) => updateInstance(index, event.target.value)}
                      placeholder={`us-east-${index + 1}.example.com`}
                      type="text"
                      value={instance}
                    />
                    <input
                      aria-label={`Instance ${index + 1} health-check URL or path`}
                      onChange={(event) => setHealthPaths((current) => current.map((path, i) => i === index ? event.target.value : path))}
                      placeholder="/health (optional)"
                      type="text"
                      value={healthPaths[index]}
                    />
                    {instances.length > 1 ? (
                      <button
                        aria-label={`Remove instance ${index + 1}`}
                        className="remove-instance-button"
                        onClick={() => removeInstance(index)}
                        type="button"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              {formError ? <p className="form-error" role="alert">{formError}</p> : null}

              <div className="dialog-actions">
                <button className="cancel-button" onClick={closeDialog} type="button">Cancel</button>
                <button className="submit-platform-button" disabled={saving} type="submit">{saving ? "Saving…" : "Create platform"}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
