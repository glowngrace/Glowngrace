import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { findPartner, productImageUrl, type Partner } from '../data/catalog';

/**
 * A single partner parlour, at `/partners/:partnerSlug`.
 *
 * The layout follows the reference partner profile: a full-bleed photo slider
 * on top, a profile card that overlaps it, a run of headline numbers, then a
 * wide column of about / gallery / services beside a sticky sidebar of contact
 * details and opening hours. Styling is the house style rather than the
 * reference's, so it sits alongside the other storefront pages.
 */

const ratingLabel = (rating: number) => rating.toFixed(1);

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="detail-stars" aria-label={`${ratingLabel(rating)} out of 5 stars`}>
      {Array.from({ length: 5 }, (_value, index) => (
        <span key={index} aria-hidden="true" className={index < Math.round(rating) ? 'is-filled' : ''}>★</span>
      ))}
    </span>
  );
}

function Banner({ partner }: { partner: Partner }) {
  const slides = partner.images;
  const [active, setActive] = useState(0);

  function step(direction: number) {
    setActive((current) => (current + direction + slides.length) % slides.length);
  }

  return (
    <div className="partner-banner">
      {slides.map((image, index) => (
        <div className={`partner-banner-slide${index === active ? ' is-active' : ''}`} key={image} style={{ backgroundImage: `url(${productImageUrl(image)})` }} />
      ))}
      <Link className="partner-banner-back" to="/partners">← Back to Partners</Link>
      <div className="partner-banner-badges">
        <span className="partner-banner-badge is-gold">⭐ {ratingLabel(partner.rating)}</span>
        <span className="partner-banner-badge">Since {partner.estd}</span>
      </div>
      {slides.length > 1 && (
        <>
          <button className="partner-banner-arrow is-left" type="button" onClick={() => step(-1)} aria-label="Previous photo">‹</button>
          <button className="partner-banner-arrow is-right" type="button" onClick={() => step(1)} aria-label="Next photo">›</button>
        </>
      )}
      <span className="partner-banner-caption">Photo {active + 1} / {slides.length}</span>
      {slides.length > 1 && (
        <div className="partner-banner-dots">
          {slides.map((image, index) => (
            <button
              className={`partner-banner-dot${index === active ? ' is-active' : ''}`}
              type="button"
              key={image}
              aria-label={`Show photo ${index + 1}`}
              aria-pressed={index === active}
              onClick={() => setActive(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PhotoGallery({ partner, onOpen }: { partner: Partner; onOpen: (index: number) => void }) {
  return (
    <div className="partner-gallery">
      {partner.images.map((image, index) => (
        <button
          className={`partner-gallery-item${index === 0 ? ' is-tall' : ''}`}
          type="button"
          key={image}
          onClick={() => onOpen(index)}
          aria-label={`View ${partner.name} photo ${index + 1}`}
        >
          <img src={productImageUrl(image)} alt={`${partner.name} photo ${index + 1}`} loading="lazy" />
        </button>
      ))}
    </div>
  );
}

export function PartnerDetailPage() {
  const { partnerSlug } = useParams();
  const partner = findPartner(partnerSlug);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const photoCount = partner?.images.length ?? 0;

  const stepThroughPhotos = useCallback((direction: number) => {
    setLightboxIndex((current) => current === null ? null : (current + direction + photoCount) % photoCount);
  }, [photoCount]);

  useEffect(() => {
    if (lightboxIndex === null) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setLightboxIndex(null);
      if (event.key === 'ArrowRight') stepThroughPhotos(1);
      if (event.key === 'ArrowLeft') stepThroughPhotos(-1);
    }

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [lightboxIndex, stepThroughPhotos]);

  if (!partner) {
    return (
      <section className="section">
        <div className="page-container empty-state">
          <span className="eyebrow">A little detour</span>
          <h1>We couldn’t find that parlour.</h1>
          <p>It may have moved, or it may no longer be with us.</p>
          <Link className="button button-dark" to="/partners">Back to our partners</Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <Banner partner={partner} />

      <div className="page-container partner-profile-wrap">
        <div className="partner-profile-card">
          <div className="partner-profile-avatar">
            <img src={productImageUrl(partner.image)} alt={`${partner.name} parlour`} />
          </div>
          <div className="partner-profile-main">
            <p className="partner-profile-type">{partner.type}</p>
            <h1>{partner.name}</h1>
            <p className="partner-profile-location">✦ {partner.area}, Lucknow</p>
            <p className="partner-profile-rating">
              <StarRow rating={partner.rating} />
              <span>{ratingLabel(partner.rating)} · {partner.reviews} reviews</span>
            </p>
          </div>
          <div className="partner-profile-actions">
            <Link className="button button-dark" to={`/contact?topic=${encodeURIComponent(`Book at ${partner.name}`)}`}>Book an appointment</Link>
            <a className="button button-line" href={`tel:${partner.phone.replace(/\s/g, '')}`}>Call {partner.phone}</a>
          </div>
        </div>

        <div className="partner-stats">
          <div className="partner-stat"><strong>{partner.staff}</strong><span>Expert staff</span></div>
          <div className="partner-stat"><strong>{partner.services}</strong><span>Services</span></div>
          <div className="partner-stat"><strong>{partner.estd}</strong><span>Established</span></div>
          <div className="partner-stat"><strong>{photoCount}</strong><span>Photos</span></div>
        </div>

        <div className="partner-body">
          <div>
            <section className="partner-section">
              <h2>About</h2>
              <p>{partner.description}</p>
              <div className="partner-tags">
                {partner.tags.map((tag) => <span className="partner-tag" key={tag}>{tag}</span>)}
              </div>
            </section>

            <section className="partner-section">
              <h2>Photo Gallery</h2>
              <PhotoGallery partner={partner} onOpen={setLightboxIndex} />
            </section>

            <section className="partner-section">
              <h2>Services &amp; Pricing</h2>
              <div className="partner-services">
                {partner.menu.map((service, index) => (
                  <article className="partner-service" key={service.name}>
                    <span className="partner-service-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    <div className="partner-service-name">
                      <strong>{service.name}</strong>
                      {service.duration && <span className="partner-service-duration">⏱ {service.duration}</span>}
                      {service.description && <span className="partner-service-note">{service.description}</span>}
                    </div>
                    <span className="partner-service-price">{service.price}</span>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <aside className="partner-aside">
            <div className="partner-side-card">
              <h3>Information</h3>
              <div className="partner-info-row">
                <span className="partner-info-icon" aria-hidden="true">◉</span>
                <div className="partner-info-text"><strong>{partner.area}</strong><span>Lucknow, Uttar Pradesh</span></div>
              </div>
              <div className="partner-info-row">
                <span className="partner-info-icon" aria-hidden="true">☎</span>
                <div className="partner-info-text"><strong>{partner.phone}</strong><span>Call to book</span></div>
              </div>
              <div className="partner-info-row">
                <span className="partner-info-icon" aria-hidden="true">✉</span>
                <div className="partner-info-text"><strong>{partner.email}</strong><span>Written enquiries welcome</span></div>
              </div>
              <div className="partner-info-row">
                <span className="partner-info-icon" aria-hidden="true">✓</span>
                <div className="partner-info-text"><strong>Verified partner</strong><span>Checked by Glow &amp; Grace</span></div>
              </div>
            </div>

            <div className="partner-side-card">
              <h3>Opening Hours</h3>
              {partner.hours.map((slot) => (
                <div className={`partner-hours-row${slot.today ? ' is-today' : ''}`} key={slot.label}>
                  <span>{slot.label}</span><span>{slot.time}</span>
                </div>
              ))}
              <Link className="button button-dark button-full" to={`/contact?topic=${encodeURIComponent(`Book at ${partner.name}`)}`}>Book now</Link>
            </div>
          </aside>
        </div>
      </div>

      {lightboxIndex !== null && partner.images[lightboxIndex] && (
        <div
          className="partner-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Photo ${lightboxIndex + 1} of ${partner.name}`}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setLightboxIndex(null); }}
        >
          <button className="partner-lightbox-close" type="button" aria-label="Close photo" onClick={() => setLightboxIndex(null)}>×</button>
          {partner.images.length > 1 && (
            <>
              <button className="partner-lightbox-nav is-prev" type="button" aria-label="Previous photo" onClick={() => stepThroughPhotos(-1)}>‹</button>
              <button className="partner-lightbox-nav is-next" type="button" aria-label="Next photo" onClick={() => stepThroughPhotos(1)}>›</button>
            </>
          )}
          <img src={productImageUrl(partner.images[lightboxIndex])} alt={`${partner.name} photo ${lightboxIndex + 1}`} />
          <p className="partner-lightbox-caption">{partner.name} · Photo {lightboxIndex + 1} of {partner.images.length}</p>
        </div>
      )}
    </>
  );
}
