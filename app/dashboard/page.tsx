"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type PlatformStatus = "critical" | "warning" | "healthy";

type Platform = {
  id: string;
  name: string;
  instances: string[];
  status: PlatformStatus;
};

const platformStatuses: PlatformStatus[] = [
  "critical",
  "warning",
  "warning",
  ...Array.from({ length: 12 }, () => "healthy" as const),
];

const defaultPlatforms: Platform[] = platformStatuses.map((status, index) => ({
  id: `platform-${index + 1}`,
  name: `Platform ${index + 1}`,
  instances: [],
  status,
}));

const storageKey = "nighthawk-platforms";

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
  const [createdPlatforms, setCreatedPlatforms] = useState<Platform[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [platformName, setPlatformName] = useState("");
  const [instances, setInstances] = useState([""]);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    try {
      const savedPlatforms = window.localStorage.getItem(storageKey);

      if (savedPlatforms) {
        setCreatedPlatforms(JSON.parse(savedPlatforms) as Platform[]);
      }
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, []);

  const closeDialog = () => {
    setIsDialogOpen(false);
    setPlatformName("");
    setInstances([""]);
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
    setInstances((current) => current.filter((_, instanceIndex) => instanceIndex !== index));
  };

  const createPlatform = (event: FormEvent<HTMLFormElement>) => {
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

    const platform: Platform = {
      id: crypto.randomUUID(),
      name: hostname,
      instances: normalizedInstances as string[],
      status: "healthy",
    };
    const nextPlatforms = [platform, ...createdPlatforms];

    setCreatedPlatforms(nextPlatforms);
    window.localStorage.setItem(storageKey, JSON.stringify(nextPlatforms));
    closeDialog();
  };

  const platforms = [...createdPlatforms, ...defaultPlatforms];

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
          <div className="platform-grid" aria-label="Platform status overview">
            {platforms.map((platform) => (
              <article className="platform-card" key={platform.id}>
                <div
                  aria-label={`${platform.name}: ${platform.status}`}
                  className={`platform-tile platform-tile--${platform.status}`}
                  role="img"
                />
                <h2>{platform.name}</h2>
                <p>
                  {platform.instances.length
                    ? `${platform.instances.length} ${platform.instances.length === 1 ? "instance" : "instances"}`
                    : "No instances"}
                </p>
              </article>
            ))}
          </div>
        </section>
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
                  onClick={() => setInstances((current) => [...current, ""])}
                  type="button"
                >
                  + Add instance
                </button>
              </div>
              <p className="field-hint">Add each URL where this site is deployed.</p>

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
                <button className="submit-platform-button" type="submit">Create platform</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
