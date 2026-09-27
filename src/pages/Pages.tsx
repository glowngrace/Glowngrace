import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { categories, jobs, partners, productImageUrl } from '../data/catalog';
import { submitContactRequest } from '../lib/api';
import { useCart } from '../components/CartContext';
import { useProductCatalog } from '../components/ProductCatalogContext';
import { ProductGrid } from '../components/ProductCard';

type PageProps = { favorites: number[]; toggleFavorite: (productId: number) => void };
const money = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

function SectionHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy?: string }) {
  return (
    <div className="section-heading">
      <span className="eyebrow">{eyebrow}</span>
      <span className="gold-rule" />
      <h2>{title}</h2>
      {copy && <p>{copy}</p>}
    </div>
  );
}

export function HomePage({ favorites, toggleFavorite }: PageProps) {
  const { products } = useProductCatalog();
  return (
    <>
      <section className="hero">
        <img className="hero-image" src="/images/hero1.jpg" alt="A bride ready for her special day" fetchPriority="high" />
        <div className="hero-wash" />
        <div className="hero-content">
          <span className="eyebrow">A beauty house, with heart · Lucknow</span>
          <h1>Beauty that feels<br />like <em>you.</em></h1>
          <p>Thoughtfully chosen beauty. Work worth celebrating. A little more grace in everything we do.</p>
          <div className="hero-actions">
            <Link className="button button-gold" to="/shop">Discover the collection</Link>
            <Link className="button button-outline-light" to="/careers">Find your next chapter</Link>
          </div>
          <div className="hero-proof"><span>✦</span> Loved in Lucknow since 2015 <i /> 150+ salon partners</div>
        </div>
        <div className="hero-side-note">CARE, CRAFT &amp; COMMUNITY</div>
      </section>

      <div className="assurance-bar">
        <span><i /> 100% authentic</span><span><i /> Thoughtfully curated</span><span><i /> Free Lucknow delivery</span><span><i /> Verified beauty careers</span>
      </div>

      <section className="section section-categories">
        <div className="page-container">
          <SectionHeading eyebrow="Find your kind of glow" title="A little something for every ritual" copy="Considered essentials and small indulgences, chosen with Indian skin, seasons and celebrations in mind." />
          <div className="category-grid">
            {categories.map((category, index) => (
              <Link className={`category-card category-${index + 1}`} to={`/shop?category=${encodeURIComponent(category.name)}`} key={category.name}>
                <img src={`/images/${category.image}`} alt="" loading="lazy" />
                <span className="category-overlay" />
                <span className="category-copy"><small>{category.note}</small><strong>{category.name}</strong><span className="category-explore">Explore the edit <i>↗</i></span></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-soft">
        <div className="page-container">
          <div className="section-heading heading-with-link">
            <div><span className="eyebrow">Picked with intention</span><span className="gold-rule" /><h2>The glow-getters</h2><p>Most-loved little luxuries, chosen by you.</p></div>
            <Link className="underlined-link" to="/shop">See the whole collection <span>↗</span></Link>
          </div>
          <ProductGrid items={products.slice(0, 4)} favorites={favorites} toggleFavorite={toggleFavorite} />
        </div>
      </section>

      <section className="section story-section">
        <div className="page-container story-layout">
          <div className="story-image"><img src="/images/about.jpg" alt="A quiet moment at the Glow & Grace beauty house" loading="lazy" /><span className="image-caption">Rooted in Lucknow · Since 2015</span></div>
          <div className="story-copy">
            <span className="eyebrow">More than a beauty counter</span><span className="gold-rule" />
            <h2>Good beauty should do a little good, too.</h2>
            <p>We started with a simple belief: authentic beauty should be easy to find, and a good career should be possible to build. Today, we bring the two together under one roof.</p>
            <div className="story-stats"><div><strong>5,000+</strong><span>happy clients</span></div><div><strong>200+</strong><span>careers placed</span></div><div><strong>150+</strong><span>salon partners</span></div></div>
            <Link className="button button-dark" to="/about">A little about us</Link>
          </div>
        </div>
      </section>

      <section className="section section-soft">
        <div className="page-container">
          <SectionHeading eyebrow="Good company, good craft" title="Our partner parlours" copy="Meet the independent beauty houses bringing a little more care to Lucknow." />
          <div className="partner-grid">
            {partners.map((partner) => (
              <article className="partner-card" key={partner.name}>
                <Link to="/partners" className="partner-image"><img src={`/images/${partner.image}`} alt={`${partner.name} salon`} loading="lazy" /><span>Meet the parlour ↗</span></Link>
                <div className="partner-card-copy"><span className="eyebrow">{partner.specialty}</span><h3>{partner.name}</h3><p>{partner.location} <span className="rating">★ {partner.rating}</span></p></div>
              </article>
            ))}
          </div>
          <div className="centered-link"><Link className="underlined-link" to="/partners">See all our partners <span>↗</span></Link></div>
        </div>
      </section>

      <section className="section careers-feature">
        <div className="careers-photo"><img src="/images/careers.jpg" alt="Beauty professionals learning their craft" loading="lazy" /></div>
        <div className="careers-copy">
          <span className="eyebrow">A career with room to bloom</span><span className="gold-rule" />
          <h2>Your talent deserves<br />a beautiful next step.</h2>
          <p>Real openings. Fair pay. A little help getting there — and someone in your corner once you do.</p>
          <div className="careers-points"><span><b>01</b> Meet verified employers</span><span><b>02</b> Build your skills with us</span><span><b>03</b> Grow with support</span></div>
          <Link className="button button-dark" to="/careers">Explore beauty careers</Link>
        </div>
      </section>

      <section className="section testimonial-section">
        <div className="page-container">
          <SectionHeading eyebrow="Kind words, honestly earned" title="A little love from our community" />
          <div className="testimonial-grid">
            <blockquote><span className="quote-mark">“</span><p>The shade matching at the Hazratganj studio was better than anything I have had in Delhi. My bridal look lasted through a twelve hour function.</p><footer><strong>Ritika Srivastava</strong><span>Customer · Gomti Nagar</span></footer></blockquote>
            <blockquote><span className="quote-mark">“</span><p>I trained here and was placed within three weeks. The team negotiated my salary and still checks in on me every month.</p><footer><strong>Anjali Verma</strong><span>Beautician · Lucknow</span></footer></blockquote>
            <blockquote><span className="quote-mark">“</span><p>As a salon owner, the talent they send is genuinely trained. We have hired six professionals through Glow &amp; Grace.</p><footer><strong>Sana Khan</strong><span>Salon partner · Lucknow</span></footer></blockquote>
          </div>
        </div>
      </section>

      <section className="closing-banner">
        <img src="/images/cta.jpg" alt="" loading="lazy" />
        <div className="closing-overlay" />
        <div><span className="eyebrow">A good thing starts here</span><h2>Shop the glow.<br />Build the career.</h2><div className="hero-actions"><Link className="button button-gold" to="/shop">Shop the collection</Link><Link className="button button-outline-light" to="/careers">Find your next chapter</Link></div></div>
      </section>
    </>
  );
}

export function ShopPage({ favorites, toggleFavorite }: PageProps) {
  const { products } = useProductCatalog();
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = searchParams.get('category') ?? 'All';
  const filters = ['All', ...categories.map((category) => category.name)];
  const shownProducts = selected === 'All' ? products : products.filter((product) => product.category === selected);

  function selectCategory(category: string) {
    if (category === 'All') setSearchParams({});
    else setSearchParams({ category });
  }

  return (
    <>
      <PageBanner eyebrow="The beauty house edit" title="The Collection" copy="Authentic beauty, thoughtful formulas and a few little luxuries. Picked for the way we live, here in Lucknow." />
      <section className="section">
        <div className="page-container">
          <div className="shop-toolbar"><div className="filter-list" aria-label="Filter by category">{filters.map((category) => <button type="button" key={category} aria-pressed={selected === category} className={selected === category ? 'filter-chip selected' : 'filter-chip'} onClick={() => selectCategory(category)}>{category}</button>)}</div><span>{shownProducts.length} considered essentials</span></div>
          <ProductGrid items={shownProducts} favorites={favorites} toggleFavorite={toggleFavorite} />
        </div>
      </section>
    </>
  );
}

function PageBanner({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <section className="page-banner"><div className="page-container"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><span className="gold-rule" /><p>{copy}</p></div></section>;
}

export function ProductPage({ favorites, toggleFavorite }: PageProps) {
  const { products, loading } = useProductCatalog();
  const { productId } = useParams();
  const product = products.find((item) => item.id === Number(productId));
  const { add } = useCart();
  const [image, setImage] = useState(product?.image ?? '');
  const [quantity, setQuantity] = useState(1);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [hasMoreDescription, setHasMoreDescription] = useState(false);
  const [isImageExpanded, setIsImageExpanded] = useState(false);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    setImage(product?.image ?? '');
    setQuantity(1);
    setDescriptionExpanded(false);
    setIsImageExpanded(false);
  }, [product?.id, product?.image]);
  useEffect(() => {
    const description = descriptionRef.current;
    if (!description || descriptionExpanded) return;
    const measure = () => setHasMoreDescription(
      description.scrollHeight > description.clientHeight + 1 || description.textContent!.length > 180,
    );
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [descriptionExpanded, product?.description]);
  useEffect(() => {
    if (!isImageExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsImageExpanded(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isImageExpanded]);
  if (!product) {
    if (loading) return <section className="section"><div className="page-container empty-state"><p role="status">Loading this beauty-house favourite…</p></div></section>;
    return <section className="section"><div className="page-container empty-state"><span className="eyebrow">A little detour</span><h1>That beauty has gone missing.</h1><Link className="button button-dark" to="/shop">Back to the collection</Link></div></section>;
  }
  const related = products.filter((item) => item.category === product.category && item.id !== product.id).slice(0, 4);

  return (
    <>
      <section className="section product-detail-section">
        <div className="page-container product-detail">
          <div className="product-gallery">
            <button className="product-feature-image" type="button" aria-label={`View larger image of ${product.name}`} onClick={() => setIsImageExpanded(true)}><img src={productImageUrl(image || product.image)} alt={product.name} /></button>
            <div className="gallery-thumbnails">{(product.images?.length ? product.images : [product.image, ...(product.category === 'Makeup' ? ['cat_makeup.jpg', 'p_glow_kit.jpg'] : [])]).filter((file, index, list) => list.indexOf(file) === index).map((file) => <button type="button" key={file} aria-label={`View ${file}`} aria-pressed={(image || product.image) === file} onClick={() => setImage(file)}><img src={productImageUrl(file)} alt="" /></button>)}</div>
          </div>
          <div className="product-detail-copy">
            <nav className="product-breadcrumb" aria-label="Breadcrumb"><Link to="/">Home</Link><span>/</span><Link to="/shop">Shop</Link><span>/</span><span>{product.category}</span></nav>
            <h1>{product.name}</h1>
            <div className="detail-rating"><span className="detail-stars" aria-label={`${product.rating.toFixed(1)} out of 5 stars`}>{Array.from({ length: 5 }, (_value, index) => <span key={index} aria-hidden="true" className={index < Math.round(product.rating) ? 'is-filled' : ''}>★</span>)}</span><span>{product.rating.toFixed(1)} · {product.reviews} reviews</span></div>
            <div className="detail-price"><strong>{money(product.price)}</strong>{product.mrp > product.price && <del>{money(product.mrp)}</del>}</div>
            <p ref={descriptionRef} className={`detail-description${descriptionExpanded ? '' : ' is-collapsed'}`}>{product.description}</p>
            {hasMoreDescription && <button className="description-toggle" type="button" aria-expanded={descriptionExpanded} onClick={() => setDescriptionExpanded((expanded) => !expanded)}>{descriptionExpanded ? 'Read less' : 'Read more'}</button>}
            <div className="product-detail-actions">
              <div className="product-quantity" aria-label="Quantity">
                <button type="button" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantity((current) => Math.max(1, current - 1))}>−</button>
                <span aria-live="polite">{quantity}</span>
                <button type="button" aria-label="Increase quantity" disabled={quantity >= 99} onClick={() => setQuantity((current) => Math.min(99, current + 1))}>+</button>
              </div>
              <button className="button button-dark" type="button" onClick={() => add(product, quantity)}>Add to bag · {money(product.price)}</button>
              <button className="button button-light detail-wishlist" type="button" aria-pressed={favorites.includes(product.id)} aria-label={favorites.includes(product.id) ? 'Remove from your wishlist' : 'Save to your wishlist'} onClick={() => toggleFavorite(product.id)}>{favorites.includes(product.id) ? '♥' : '♡'}</button>
            </div>
            <div className="product-accordions">
              <details>
                <summary>Description <span aria-hidden="true">+</span></summary>
                <p>{product.description}</p>
              </details>
              <details>
                <summary>How to use <span aria-hidden="true">+</span></summary>
                <p>Follow the directions on the product packaging. If you have questions about how this product fits your routine, <Link to="/contact">ask our team</Link>.</p>
              </details>
              <details>
                <summary>Shipping &amp; returns <span aria-hidden="true">+</span></summary>
                <p>Choose from the available delivery options at checkout. Cash on delivery is available for eligible orders. For help with an order or return, <Link to="/contact">contact our team</Link>.</p>
              </details>
            </div>
            <div className="delivery-note"><strong>A little note on delivery</strong><span>Need a recommendation? <Link to="/contact">We’re happy to help.</Link></span></div>
          </div>
        </div>
      </section>
      {isImageExpanded && <div className="product-lightbox" role="dialog" aria-modal="true" aria-label={`Product image: ${product.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setIsImageExpanded(false); }}>
        <button className="product-lightbox-close" type="button" aria-label="Close enlarged image" onClick={() => setIsImageExpanded(false)}>×</button>
        <img src={productImageUrl(image || product.image)} alt={product.name} />
      </div>}
      {related.length > 0 && <section className="section section-soft"><div className="page-container"><SectionHeading eyebrow="Complete the ritual" title="You may love these, too" /><ProductGrid items={related} favorites={favorites} toggleFavorite={toggleFavorite} /></div></section>}
    </>
  );
}

export function PartnersPage() {
  return (
    <>
      <PageBanner eyebrow="Good company, good craft" title="Partner Parlours" copy="Independent beauty houses with a shared belief in thoughtful service, talented teams and genuine care." />
      <section className="section"><div className="page-container partner-directory">{partners.map((partner) => <article className="directory-card" key={partner.name}><img src={`/images/${partner.image}`} alt={`${partner.name} salon`} loading="lazy" /><div className="directory-info"><span className="eyebrow">{partner.specialty}</span><h2>{partner.name}</h2><p>{partner.location}</p><p><span className="rating">★ {partner.rating}</span> · Verified Glow &amp; Grace partner</p><Link className="underlined-link" to="/contact?topic=Salon%20partnership">Ask about this parlour <span>↗</span></Link></div></article>)}</div></section>
      <section className="section section-soft"><div className="page-container split-feature"><div><span className="eyebrow">For salon owners</span><span className="gold-rule" /><h2>Good people make a beautiful business.</h2><p>Find skilled professionals, stock authentic retail favourites and put your salon in front of the right people. We make it easy to grow together.</p><ul className="benefit-list"><li>A vetted pool of beauty professionals</li><li>Wholesale pricing on the full retail edit</li><li>Training and placement support</li></ul><Link className="button button-dark" to="/contact?topic=Salon%20partnership">Become a partner</Link></div><img src="/images/partner3.jpg" alt="Inside one of our partner beauty parlours" loading="lazy" /></div></section>
    </>
  );
}

export function CareersPage() {
  return (
    <>
      <PageBanner eyebrow="A career with room to bloom" title="Beauty Careers" copy="Verified openings, honest salaries and real support — from your first application to the first ninety days on the job." />
      <section className="section"><div className="page-container"><SectionHeading eyebrow="Good work, good people" title="Opportunities around Lucknow" copy="Every listing is checked with the employer, so you know what you’re applying for." /><div className="job-list">{jobs.map((job) => <article className="job-card" key={job.title}><div className="job-symbol">✦</div><div className="job-main"><span className="eyebrow">{job.salon} · {job.kind}</span><h2>{job.title}</h2><p>{job.location} <span>·</span> {job.experience}</p></div><div className="job-pay"><strong>{job.salary}</strong><span>per month</span></div><Link className="button button-dark" to={`/contact?topic=${encodeURIComponent(`Apply for ${job.title}`)}`}>I’m interested</Link></article>)}</div></div></section>
      <section className="section section-soft"><div className="page-container split-feature"><img src="/images/careers.jpg" alt="A hands-on beauty skills workshop" loading="lazy" /><div><span className="eyebrow">Skill studio</span><span className="gold-rule" /><h2>Learn the craft. Find your people.</h2><p>Practical certification tracks built with working artists and salon owners — with introductions to employers who are ready to meet you.</p><div className="course-list"><span><b>06 weeks</b> Bridal makeup &amp; airbrush</span><span><b>04 weeks</b> Hair styling &amp; spa care</span><span><b>03 weeks</b> Nail art &amp; extensions</span></div><Link className="button button-dark" to="/contact?topic=Training%20courses">Ask us about training</Link></div></div></section>
    </>
  );
}

export function AboutPage() {
  return (
    <>
      <PageBanner eyebrow="Since 2015 · Lucknow" title="Our Story" copy="Two promises, one house: thoughtful beauty for our community, and honest opportunities for the people who make it." />
      <section className="section"><div className="page-container story-layout about-story"><div className="story-image"><img src="/images/partner1.jpg" alt="Beauty and care at the heart of Glow & Grace" /><span className="image-caption">A little house with a lot of heart</span></div><div className="story-copy"><span className="eyebrow">Two promises, one house</span><span className="gold-rule" /><h2>Beauty that gives back a little.</h2><p>Glow &amp; Grace began as a small counter in Lucknow with a simple belief: authentic beauty products and honest career opportunities should never be hard to find.</p><p>Today, we serve thousands of customers, work with independent salons across the city and help beauty professionals build careers they can feel proud of. We still believe the best kind of glow is the one we share.</p><Link className="button button-dark" to="/contact">Come say hello</Link></div></div></section>
      <section className="section section-soft values-section"><div className="page-container"><SectionHeading eyebrow="What matters in our house" title="A few things we’ll always believe" /><div className="values-grid"><article><span>01</span><h3>Authenticity</h3><p>Real products, honest advice and recommendations that begin with what you actually need.</p></article><article><span>02</span><h3>Dignity of work</h3><p>Beauty is a craft. The people who practise it deserve fair pay, respect and room to grow.</p></article><article><span>03</span><h3>Care in the details</h3><p>Thoughtful service, considered choices and showing up for our Lucknow community.</p></article></div></div></section>
      <section className="visit-banner"><div><span className="eyebrow">A little hello in person</span><h2>Come and see us in Lucknow.</h2><Link className="button button-gold" to="/contact">Plan a visit</Link></div><img src="/images/partner2.jpg" alt="Welcome to our beauty house" loading="lazy" /></section>
    </>
  );
}

const contactTopics = ['Shopping & product advice', 'Beauty career / job', 'Salon partnership', 'Training courses', 'Bulk / wholesale order', 'Account and order help'];

export function ContactPage() {
  const [searchParams] = useSearchParams();
  const requestedTopic = searchParams.get('topic') ?? '';
  const selectedTopic = contactTopics.find((topic) => topic.toLowerCase() === requestedTopic.toLowerCase())
    ?? (requestedTopic.toLowerCase().startsWith('apply for ') ? requestedTopic : contactTopics[0]);
  const availableTopics = contactTopics.includes(selectedTopic) ? contactTopics : [selectedTopic, ...contactTopics];
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setSubmitting(true);
    setStatus('');
    try {
      const result = await submitContactRequest({
        name: String(values.get('name') ?? ''),
        email: String(values.get('email') ?? ''),
        phone: String(values.get('phone') ?? ''),
        topic: String(values.get('topic') ?? ''),
        message: String(values.get('message') ?? ''),
      });
      setStatus(result.message ?? 'Thank you. Your note is on its way.');
      form.reset();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'We could not send your message. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageBanner eyebrow="We’re here, and we’re listening" title="Get in Touch" copy="Shopping question, salon partnership or a career on your mind? Tell us a little and we’ll get back to you within one working day." />
      <section className="section"><div className="page-container contact-layout"><div className="contact-aside"><span className="eyebrow">A note to our house</span><span className="gold-rule" /><h2>Tell us what’s on your mind.</h2><p>Real people read every message. We’ll make sure your note finds the right person.</p><img src="/images/partner2.jpg" alt="A welcoming space at our Lucknow beauty house" loading="lazy" /><div className="contact-details"><span><strong>Find us</strong><span>Hazratganj, Lucknow, Uttar Pradesh</span></span><span><strong>Say hello</strong><a href="mailto:hello@glowandgrace.in">hello@glowandgrace.in</a></span><span><strong>Hours</strong><span>Monday – Saturday · 10 am – 7 pm</span></span></div></div>
        <form className="contact-form" onSubmit={submit}>
          <div className="form-row"><label>Full name<input name="name" autoComplete="name" placeholder="Your name" minLength={2} maxLength={120} required /></label><label>Mobile number<input name="phone" type="tel" autoComplete="tel" placeholder="+91" maxLength={32} /></label></div>
          <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@email.com" maxLength={254} required /></label>
          <label>I’m reaching out about<select name="topic" defaultValue={selectedTopic}>{availableTopics.map((topic) => <option key={topic}>{topic}</option>)}</select></label>
          <label>Your message<textarea name="message" rows={6} minLength={10} maxLength={3000} placeholder="Tell us how we can help…" required /></label>
          <button className="button button-dark" type="submit" disabled={submitting}>{submitting ? 'Sending your note…' : 'Send us a note'}</button>
          <p className="form-status" role="status" aria-live="polite">{status}</p>
        </form>
      </div></section>
    </>
  );
}
