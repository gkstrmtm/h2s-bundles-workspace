import { createHash } from 'node:crypto';
import equipment from '../../config/pricing/equipment.v1.json';
import cameraConfiguration from '../../config/pricing/residential-cameras.v1.json';
import knowledge from '../../config/pricing/field-offer-knowledge.v1.json';
import canonical from '../../config/pricing/home2smart.v2.json';
import launch from '../../config/pricing/offers/residential/v5-launch-proposed.json';
import { cameraQualificationFailures, rankCameraPreference } from '../../config/pricing/camera-recommendations.cjs';
import { BusinessError } from '@/lib/fieldSales';
import { calculateFieldQuote, QuoteCatalog, QuoteGuidance, QuoteOffer } from '@/lib/fieldQuote';

type Choice = 'supplied' | 'customer' | null;
type MountStyle = 'fixed' | 'tilt' | 'full_motion' | null;
export type TvDiscovery = { location: string; size: number | null; weight: number | null; vesaWidth: number | null;
  vesaHeight: number | null; ownership: Choice; mountStyle: MountStyle; surface: 'drywall' | 'masonry' | 'fireplace' | 'other' | null;
  concealment: 'external' | 'in_wall' | 'none' | null; compatibilityVerified: boolean | null };
export type CameraDiscovery = { id: string; coverage: string[]; outdoor: boolean | null; coveragePositionVerified: boolean | null;
  sunlightSuitable: boolean | null; directSunHours: number | null; batteryMaintenanceAccepted: boolean | null;
  c31PowerCompatible: boolean | null; floodlightPowerCompatible: boolean | null; wifiConfirmed: boolean | null;
  homebaseLinkConfirmed: boolean | null; mountingCompatible: boolean | null; standardInstallation: boolean | null;
  requiredFeatures: string[]; preferredEquipmentId: string | null; ownership: Choice; recording: 'events' | 'continuous' | null;
  storageVerified: boolean | null; equipmentCompatibilityVerified: boolean | null };
export type OfferDiscovery = { schemaVersion: 1; step: number; services: string[]; tvs: TvDiscovery[]; cameras: CameraDiscovery[];
  tvQuantity: number | null; cameraQuantity: number | null;
  catalogId: string | null; preferences: { priority: 'balanced' | 'budget' | 'premium'; storage: 'no_preference' | 'standalone' | 'shared_homebase'; homebaseType: 'homebase_2' | 'homebase_s380' };
  existingHub: { type: 'none' | 'homebase_2' | 'homebase_s380'; compatibilityVerified: boolean | null; availableCameraSlots: number | null };
  hubRouterConnectionConfirmed: boolean | null; quoteAnswers: Record<string, Record<string, string | number>> };
export type OfferLine = { serviceId: string; offerId: string; quantity: number; answers: Record<string, string | number>; options: string[] };
type Suggestion = { kind: 'tv' | 'camera'; title: string; equipmentId: string | null; equipmentName: string | null;
  alternativeId: string | null; reasons: string[]; missing: string[] };
const features = ['fixed_view','pan_tilt','tracking','zoom_detail','color_night_vision','floodlighting','continuous_recording'];
const cameraIds = equipment.cameraItems.map(item => item.id);
const booleanKeys = ['outdoor','coveragePositionVerified','sunlightSuitable','batteryMaintenanceAccepted','c31PowerCompatible',
  'floodlightPowerCompatible','wifiConfirmed','homebaseLinkConfirmed','mountingCompatible','standardInstallation','storageVerified','equipmentCompatibilityVerified'] as const;
export const offerKnowledgeHash = createHash('sha256').update(JSON.stringify({ knowledge, equipment, cameraConfiguration, canonical, launch })).digest('hex');
function object(value: unknown, allowed: string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new BusinessError(`Review ${name}; unsupported fields are not accepted.`);
  }
  return value as Record<string, unknown>;
}
function choice<T extends string>(value: unknown, options: readonly T[], name: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new BusinessError(`Review ${name}.`);
  return value as T;
}
function nullableChoice<T extends string>(value: unknown, options: readonly T[], name: string): T | null {
  return value === null ? null : choice(value, options, name);
}
function number(value: unknown, maximum: number, name: string, minimum = 0): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new BusinessError(`Review ${name}.`);
  return value;
}
function flag(value: unknown): boolean | null {
  if (value !== null && typeof value !== 'boolean') throw new BusinessError('Qualification must be yes, no or not yet known.');
  return value;
}
function strings(value: unknown, options: string[], name: string): string[] {
  if (!Array.isArray(value) || value.length > options.length || new Set(value).size !== value.length
    || value.some(item => typeof item !== 'string' || !options.includes(item))) throw new BusinessError(`Review ${name}.`);
  return value;
}
export function validateDiscovery(value: unknown): OfferDiscovery {
  const d = object(value, ['schemaVersion','step','services','tvs','cameras','tvQuantity','cameraQuantity','catalogId','preferences','existingHub','hubRouterConnectionConfirmed','quoteAnswers'], 'discovery');
  if (d.schemaVersion !== 1 || !Number.isSafeInteger(d.step) || Number(d.step) < 0 || Number(d.step) > 80
    || !Array.isArray(d.tvs) || d.tvs.length > 16 || !Array.isArray(d.cameras) || d.cameras.length > 16
    || d.tvs.length + d.cameras.length > 32) throw new BusinessError('Discovery version, progress or quantity is unsupported.');
  const services = strings(d.services, ['tv','cameras','other'], 'selected services');
  const tvQuantity=number(d.tvQuantity,100,'TV quantity',1),cameraQuantity=number(d.cameraQuantity,100,'camera quantity',1);
  if ((tvQuantity!==null && !Number.isSafeInteger(tvQuantity)) || (cameraQuantity!==null && !Number.isSafeInteger(cameraQuantity))
    || (!services.includes('tv') && tvQuantity!==null) || (!services.includes('cameras') && cameraQuantity!==null)) throw new BusinessError('Use whole quantities for selected services only.');
  if ((!services.includes('tv') && d.tvs.length) || (!services.includes('cameras') && d.cameras.length)) {
    throw new BusinessError('Remove answers for unselected services.');
  }
  const tvs = d.tvs.map(value => {
    const t = object(value, ['location','size','weight','vesaWidth','vesaHeight','ownership','mountStyle','surface','concealment','compatibilityVerified'], 'TV');
    if (typeof t.location !== 'string' || t.location.length > 100) throw new BusinessError('Use a short room label, not customer identifying information.');
    return { location: t.location.trim(), size: number(t.size,150,'TV size',19), weight: number(t.weight,400,'TV weight',1),
      vesaWidth: number(t.vesaWidth,2000,'VESA width',20), vesaHeight: number(t.vesaHeight,2000,'VESA height',20),
      ownership: nullableChoice(t.ownership,['supplied','customer'],'mount ownership'), mountStyle: nullableChoice(t.mountStyle,['fixed','tilt','full_motion'],'mount style'),
      surface: nullableChoice(t.surface,['drywall','masonry','fireplace','other'],'mounting surface'),
      concealment: nullableChoice(t.concealment,['external','in_wall','none'],'cable treatment'), compatibilityVerified: flag(t.compatibilityVerified) };
  });
  const cameras = d.cameras.map((value,index) => {
    const c = object(value, ['id','coverage','directSunHours','requiredFeatures','preferredEquipmentId','ownership','recording',...booleanKeys], 'camera position');
    if (c.id !== 'camera_' + (index + 1)) throw new BusinessError('Camera position identifiers must follow the saved order.');
    return { id: String(c.id), coverage: strings(c.coverage,['front_door','driveway','backyard','side_yard','other'],'coverage'),
      directSunHours: number(c.directSunHours,24,'direct sunlight'), requiredFeatures: strings(c.requiredFeatures,features,'camera features'),
      preferredEquipmentId: nullableChoice(c.preferredEquipmentId,[...cameraIds,'unknown'],'camera model'),
      ownership: nullableChoice(c.ownership,['supplied','customer'],'camera ownership'),
      outdoor: flag(c.outdoor), coveragePositionVerified: flag(c.coveragePositionVerified), sunlightSuitable: flag(c.sunlightSuitable),
      batteryMaintenanceAccepted: flag(c.batteryMaintenanceAccepted), c31PowerCompatible: flag(c.c31PowerCompatible),
      floodlightPowerCompatible: flag(c.floodlightPowerCompatible), wifiConfirmed: flag(c.wifiConfirmed),
      homebaseLinkConfirmed: flag(c.homebaseLinkConfirmed), mountingCompatible: flag(c.mountingCompatible), standardInstallation: flag(c.standardInstallation),
      recording: nullableChoice(c.recording,['events','continuous'],'recording mode'), storageVerified: flag(c.storageVerified),
      equipmentCompatibilityVerified: flag(c.equipmentCompatibilityVerified) };
  });
  const p = object(d.preferences,['priority','storage','homebaseType'],'camera preferences');
  const h = object(d.existingHub,['type','compatibilityVerified','availableCameraSlots'],'existing HomeBase');
  const existingHub = { type: choice(h.type,['none','homebase_2','homebase_s380'],'HomeBase type'),
    compatibilityVerified: flag(h.compatibilityVerified), availableCameraSlots: number(h.availableCameraSlots,16,'HomeBase available slots') };
  if ((existingHub.availableCameraSlots !== null && !Number.isSafeInteger(existingHub.availableCameraSlots))
    || (existingHub.type === 'none' && (existingHub.compatibilityVerified === true || (existingHub.availableCameraSlots ?? 0) > 0))) {
    throw new BusinessError('A nonexistent HomeBase cannot have verified compatibility or available slots.');
  }
  if (d.catalogId !== null && (typeof d.catalogId !== 'string' || !/^[a-f0-9-]{36}$/i.test(d.catalogId))) throw new BusinessError('Select a valid pricing catalog.');
  if (!d.quoteAnswers || typeof d.quoteAnswers !== 'object' || Array.isArray(d.quoteAnswers) || Object.keys(d.quoteAnswers).length > 30) throw new BusinessError('Review catalog qualification answers.');
  const quoteAnswers: OfferDiscovery['quoteAnswers'] = {};
  for (const [key,value] of Object.entries(d.quoteAnswers)) {
    if (!/^[a-z0-9_-]+:[a-z0-9_-]+:[0-9]+$/.test(key) || key.length > 180 || !value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length > 30) throw new BusinessError('Review catalog question references.');
    quoteAnswers[key] = {};
    for (const [id,answer] of Object.entries(value)) {
      if (!/^[a-z][a-z0-9_-]{0,79}$/.test(id) || (typeof answer !== 'string' && typeof answer !== 'number')
        || (typeof answer === 'string' && answer.length > 2000) || (typeof answer === 'number' && !Number.isFinite(answer))) throw new BusinessError('Review catalog answers.');
      quoteAnswers[key][id] = answer;
    }
  }
  for (const camera of cameras) {
    if (camera.recording === 'events' && camera.requiredFeatures.includes('continuous_recording')) throw new BusinessError('Recording mode and required features conflict.');
    if (camera.recording === 'continuous' && !camera.requiredFeatures.includes('continuous_recording')) camera.requiredFeatures.push('continuous_recording');
  }
  return { schemaVersion: 1, step: Number(d.step), services, tvs, cameras, tvQuantity, cameraQuantity, catalogId: d.catalogId,
    preferences: { priority: choice(p.priority,['balanced','budget','premium'],'priority'), storage: choice(p.storage,['no_preference','standalone','shared_homebase'],'storage preference'),
      homebaseType: choice(p.homebaseType,['homebase_2','homebase_s380'],'new HomeBase type') },
    existingHub, hubRouterConnectionConfirmed: flag(d.hubRouterConnectionConfirmed), quoteAnswers };
}
export function productKnowledge() {
  const entries = [
    ...knowledge.faq,
    ...equipment.items.map(item => ({ id: item.id, title: item.name,
      text: 'Catalog status: ' + item.status.replace(/_/g,' ') + '. ' + item.verification.notes,
      compatibility: item.tvCompatibility, dimensions: item.dimensionsInches, sourceUrl: item.supplier.url, checkedDate: item.supplier.priceCheckDate })),
    ...equipment.cameraItems.map(item => ({ id: item.id, title: item.name,
      text: item.intendedUse + ' Catalog status: ' + item.status.replace(/_/g,' ') + '. ' + item.verification.notes,
      power: item.power.requirements, solar: item.solar.notes, wifi: item.wifi.notes, storage: item.storage.notes,
      powerMode: item.power.mode, solarSupported: item.solar.supported, requiresHomebase: item.storage.strategy==='required_homebase',
      recording: item.storage.recording === 'continuous_24_7' ? 'Continuous recording with compatible power and recording media' : 'Motion-event recording, not continuous recording',
      inclusions: item.includedAccessories, qualifications: item.verification.requirements, sourceUrl: item.supplier.url, checkedDate: item.supplier.priceCheckDate }))
  ];
  return { version: knowledge.version, hash: offerKnowledgeHash, entries };
}
const reasons: Record<string,string> = {
  outdoor_location_unconfirmed: 'Confirm this is a supported outdoor installation; indoor or other work needs review.',
  coverage_position_unverified: 'Confirm an independent coverage position.',
  mounting_unconfirmed: 'Verify the mounting surface and hardware.',
  installation_complexity_unconfirmed: 'Confirm standard installation complexity; nonstandard work needs review.',
  rotating_camera_cannot_imply_simultaneous_separate_area_coverage: 'A rotating camera cannot promise simultaneous separate-area coverage.',
  standalone_storage_required: 'This camera requires a compatible HomeBase rather than standalone storage.',
  shared_storage_path_not_standardized: 'The requested shared-storage path is not standardized for this camera.',
  homebase_radio_link_unconfirmed: 'Verify the camera-to-HomeBase radio link at this position.',
  homebase_router_connection_unconfirmed: 'Verify the HomeBase-to-router connection.',
  router_wifi_unconfirmed: 'Verify compatible camera Wi-Fi at this position.',
  sunlight_inadequate_or_unverified: 'Confirm adequate direct sunlight for solar charging.',
  battery_maintenance_unconfirmed: 'Confirm the customer accepts battery maintenance when solar charging is insufficient.',
  insufficient_verified_model_specific_sun_hours: 'Verify the model-specific minimum daily direct sunlight.',
  specific_c31_power_unconfirmed: 'Verify the exact C31 USB-C DC adapter, cable reach and weather-protected power.',
  specific_floodlight_power_unconfirmed: 'Verify compatible hardwired AC for the floodlight camera.',
  lighting_not_requested: 'A floodlight is not the requested scope.'
};
function cameraMissing(camera: typeof equipment.cameraItems[number], d: OfferDiscovery, location: CameraDiscovery): string[] {
  const profile = cameraConfiguration.recommendationPolicy.profiles.find(row => row.equipmentId === camera.id);
  if (!profile) throw new BusinessError('Camera knowledge profile is incomplete.',503);
  const failures: string[] = cameraQualificationFailures(camera,profile,location,d);
  const missing = failures.map(code => code.startsWith('unsupported_feature:')
    ? 'This model does not support the requested ' + code.slice(20).replace(/_/g,' ') + '.'
    : reasons[code] ?? 'Confirm ' + code.replace(/_/g,' ') + '.');
  if (!location.coverage.length) missing.push('Select the coverage area.');
  if (location.ownership === null) missing.push('Confirm camera ownership.');
  if (location.recording === null) missing.push('Confirm motion-event or continuous recording.');
  if (location.storageVerified !== true) missing.push('Verify recording media, storage compatibility, included versus additional media and the required retention.');
  if (location.equipmentCompatibilityVerified !== true) missing.push('Verify the exact camera SKU, manual, firmware and included accessories.');
  const requiredHubSlots=Math.max(1,d.cameras.filter(position=>position.preferredEquipmentId===camera.id
    || (position.preferredEquipmentId===null && d.preferences.storage==='shared_homebase')).length);
  if (camera.storage.strategy === 'required_homebase' && (d.existingHub.type === 'none'
    || d.existingHub.compatibilityVerified !== true || d.existingHub.availableCameraSlots === null
    || d.existingHub.availableCameraSlots < requiredHubSlots)) missing.push('Verify a compatible HomeBase with enough camera slots; a new hub and storage need an explicit catalog scope.');
  return missing;
}
function guidance(serviceId: string, offer: QuoteOffer): QuoteGuidance | undefined {
  if (offer.guidance) return offer.guidance;
  const services: Record<string,Record<string,{kind:string;ownership:string;mountStyle?:string}>> = knowledge.legacyBindings;
  const binding=services[serviceId]?.[offer.id];
  return binding ? {kind:choice(binding.kind,['tv','camera'],'knowledge service'),ownership:choice(binding.ownership,['supplied','customer'],'knowledge ownership'),
    ...(binding.mountStyle ? {mountStyle:choice(binding.mountStyle,['fixed','tilt','full_motion'] as const,'knowledge mount style')} : {})} : undefined;
}
export function recommendOffer(d: OfferDiscovery, catalogs: QuoteCatalog[], market: string) {
  const catalog = catalogs.find(item => item.catalog_id === d.catalogId && item.status !== 'retired');
  const suggestions: Suggestion[] = [], missing: string[] = [], lines: OfferLine[] = [];
  const questions: { key: string; title: string; questions: QuoteOffer['questions'] }[] = [];
  if (!d.services.length) missing.push('Choose at least one service.');
  if (!catalog) missing.push('Select an available pricing version; no price is assumed.');
  if (d.services.includes('other')) missing.push('Other services require the existing assessment and a management-approved custom quote.');
  if (d.services.includes('tv') && !d.tvs.length) missing.push('Enter the TV quantity.');
  if (d.services.includes('cameras') && !d.cameras.length) missing.push('Enter the camera coverage positions.');
  if (d.services.includes('tv') && (d.tvQuantity===null || d.tvQuantity!==d.tvs.length)) missing.push('Complete the requested individual TV count; unsupported quantities require management custom-quote review.');
  if (d.services.includes('cameras') && (d.cameraQuantity===null || d.cameraQuantity!==d.cameras.length)) missing.push('Complete the requested independent camera positions; unsupported quantities require management review.');
  if (market !== 'residential') missing.push('This homeowner assistant does not price commercial work; use the existing management quote workflow.');
  const offers = catalog?.definition.services.filter(service => service.markets.includes(market))
    .flatMap(service => service.offers.filter(offer => offer.enabled).map(offer => ({ service, offer, guidance: guidance(service.id,offer) }))) ?? [];
  function line(candidate: typeof offers[number], quantity: number, index: number, answers: Record<string,string | number>, options: string[]) {
    const key = `${candidate.service.id}:${candidate.offer.id}:${index}`;
    const supplied = d.quoteAnswers[key] ?? {};
    if (Object.keys(supplied).some(id => !candidate.offer.questions.some(question => question.id === id))) throw new BusinessError('Catalog questions changed; remove stale qualification answers.',409);
    if (Object.keys(supplied).some(id => answers[id] !== undefined && supplied[id] !== answers[id])) throw new BusinessError('Catalog answers cannot override assessed TV sizes or other server-derived facts.');
    const clean = { ...supplied, ...answers };
    const unanswered=candidate.offer.questions.filter(question => clean[question.id] === undefined || supplied[question.id] !== undefined);
    if (unanswered.length) questions.push({ key, title: candidate.offer.label, questions: unanswered });
    lines.push({ serviceId: candidate.service.id, offerId: candidate.offer.id, quantity, answers: clean, options });
  }
  for (const [index,tv] of d.tvs.entries()) {
    const unresolved: string[] = [];
    if (!tv.location) unresolved.push('Add a room or mounting-location label.');
    if (tv.size === null || tv.weight === null || tv.vesaWidth === null || tv.vesaHeight === null) unresolved.push('Confirm the individual TV size, weight and exact VESA pattern.');
    if (!tv.ownership || !tv.mountStyle) unresolved.push('Confirm mount ownership and fixed, tilt or full-motion style.');
    if (tv.compatibilityVerified !== true) unresolved.push('Verify the TV and mount manuals, exact VESA pattern, weight, wall and hardware.');
    if (tv.surface !== 'drywall') unresolved.push('Nonstandard or unconfirmed mounting surfaces require management review.');
    if (!tv.concealment || tv.concealment === 'in_wall') unresolved.push('Confirm cable treatment; in-wall concealment requires a reviewed custom scope.');
    const candidate = offers.find(item => item.guidance?.kind === 'tv' && item.guidance.ownership === tv.ownership
      && (tv.ownership === 'customer' || item.guidance.mountStyle === tv.mountStyle
        || (item.guidance.mountStyle === 'fixed' && item.offer.options.some(option => option.guidance?.mountStyle === tv.mountStyle)))
      && item.offer.minimum <= 1 && item.offer.maximum >= 1
      && item.offer.questions.some(question => question.id === 'size' && question.type === 'number' && tv.size !== null
        && tv.size >= (question.min ?? 0) && tv.size <= (question.max ?? 150)));
    const upgrade = tv.ownership === 'supplied' && candidate?.guidance?.mountStyle !== tv.mountStyle
      ? candidate?.offer.options.find(option => option.guidance?.mountStyle === tv.mountStyle) : undefined;
    const equipmentId = upgrade?.guidance?.equipmentId ?? candidate?.guidance?.equipmentId ?? null;
    const mount = equipment.items.find(item => item.id === equipmentId);
    if (tv.ownership === 'supplied' && (!mount || !mount.tvCompatibility)) unresolved.push('The selected catalog must identify the exact supplied mount; a generic fixed-mount label is not a verified SKU.');
    if (mount?.tvCompatibility && tv.size !== null && tv.weight !== null && tv.vesaWidth !== null && tv.vesaHeight !== null) {
      const c = mount.tvCompatibility;
      if (!c.vesaMm) unresolved.push('Mount VESA specifications are not established; management review is required.');
      else if (tv.size < c.minInches || tv.size > c.maxInches || tv.weight > c.maxWeightLb
        || tv.vesaWidth < c.vesaMm.minimumWidth || tv.vesaWidth > c.vesaMm.maximumWidth
        || tv.vesaHeight < c.vesaMm.minimumHeight || tv.vesaHeight > c.vesaMm.maximumHeight) unresolved.push('The TV is outside the specified mount size, weight or VESA bounds; do not substitute it.');
    }
    if (!candidate) unresolved.push('No eligible catalog offer or approved mount upgrade matches this TV; request a custom quote.');
    if (candidate && tv.size !== null) line(candidate,1,index,{ size: tv.size },upgrade ? [upgrade.id] : []);
    suggestions.push({ kind:'tv',title:`TV ${index+1}${tv.location ? ' - ' + tv.location : ''}`,equipmentId,equipmentName:mount?.name ?? (tv.ownership==='customer'?'Customer-owned compatible mount':null),alternativeId:null,
      reasons: tv.ownership === 'customer' ? ['Use an installation-only offer for the verified customer-owned mount.']
        : ['Use the exact catalog mount and included materials; upgrades require configured pricing.'],missing:unresolved });
    missing.push(...unresolved.map(reason => `TV ${index+1}: ${reason}`));
  }
  if (d.tvs.length > 3) missing.push('Four or more TVs require management custom-quote review.');
  if (d.tvs.length > 1 && !catalog?.definition.services.find(service => service.id === 'tv_mounting')?.tvMarginalDiscounts) {
    missing.push('The selected catalog does not authorize the documented 10%/15% marginal TV discounts. Management must review and publish the rule; it has not been applied.');
  }
  const qualified: { location: CameraDiscovery; camera: typeof equipment.cameraItems[number] }[] = [];
  for (const [index,location] of d.cameras.entries()) {
    const candidates = equipment.cameraItems.map(camera => ({ camera, missing:cameraMissing(camera,d,location) }))
      .filter(item => !item.missing.length)
      .sort((a,b) => {
        const rank = (camera:typeof equipment.cameraItems[number]) => rankCameraPreference(camera,
          cameraConfiguration.recommendationPolicy.profiles.find(profile=>profile.equipmentId===camera.id),location,d,d.cameras.length,false);
        return rank(a.camera)-rank(b.camera);
      });
    const requested = equipment.cameraItems.find(item => item.id === location.preferredEquipmentId);
    const chosen = requested ? candidates.find(item => item.camera.id === requested.id)?.camera
      : location.preferredEquipmentId === 'unknown' || (location.ownership === 'customer' && !location.preferredEquipmentId) ? undefined : candidates[0]?.camera;
    const unresolved = chosen ? [] : requested ? cameraMissing(requested,d,location)
      : ['No camera is fully qualified for these answers. Confirm model, recording, power, network, sunlight, storage and coverage; unknown customer equipment requires review.'];
    const alternative = candidates.find(item => item.camera.id !== chosen?.id)?.camera;
    if (chosen) qualified.push({ location,camera:chosen });
    suggestions.push({ kind:'camera',title:`Camera position ${index+1}`,equipmentId:chosen?.id ?? null,equipmentName:chosen?.name ?? null,alternativeId:alternative?.id ?? null,
      reasons: chosen ? [chosen.intendedUse,chosen.power.requirements,chosen.storage.notes,chosen.solar.notes] : [],missing:unresolved });
    missing.push(...unresolved.map(reason => `Camera position ${index+1}: ${reason}`));
  }
  for (const ownership of ['supplied','customer'] as const) {
    const group = qualified.filter(item => item.location.ownership === ownership);
    if (!group.length) continue;
    const uniqueModels = new Set(group.map(item => item.camera.id));
    const candidate = offers.find(item => item.guidance?.kind === 'camera' && item.guidance.ownership === ownership
      && item.offer.minimum <= group.length && item.offer.maximum >= group.length
      && (ownership === 'customer' || (uniqueModels.size === 1 && item.guidance.equipmentId === group[0].camera.id)));
    if (!candidate) missing.push('No catalog offer identifies this exact camera equipment/ownership and quantity. Generic packages and different models cannot be substituted; management review is required.');
    else line(candidate,group.length,16+(ownership === 'customer' ? 1 : 0),{},[]);
  }
  const quote = catalog && lines.length && market === 'residential' ? calculateFieldQuote(catalog,lines,market) : null;
  missing.push(...(quote?.approvalReasons ?? []));
  const unresolved = [...new Set(missing)];
  return { knowledgeVersion:knowledge.version,knowledgeHash:offerKnowledgeHash,catalogId:catalog?.catalog_id ?? null,
    catalogHash:catalog?.digest ?? null,catalogVersion:catalog?.version ?? null,catalogStatus:catalog?.status ?? null,
    suggestions,questions,missing:unresolved,quoteInput:lines,
    canCreateQuote:!!quote && unresolved.length === 0 && ['published','staging_only'].includes(catalog?.status ?? ''),
    verifiedPriceCents:catalog?.status === 'published' && !unresolved.length ? quote?.totalCents ?? null : null,
    stagingEstimateCents:catalog?.status === 'staging_only' && !unresolved.length ? quote?.totalCents ?? null : null,
    priceExplanation:catalog?.status === 'draft' ? 'Unpublished draft prices are not verified customer prices.'
      : unresolved.length ? 'A complete verified price is unavailable until the listed qualifications and management review are resolved.'
      : catalog?.status === 'staging_only' ? 'Synthetic staging catalog estimate only; no production publication or sales approval.'
      : 'Published catalog calculation only; the saved quote still follows the existing approval and acceptance workflow.',
    calculatedQuote:quote,
    knowledgeSnapshot:productKnowledge().entries.filter(entry=>suggestions.some(suggestion=>suggestion.equipmentId===entry.id || suggestion.alternativeId===entry.id)) };
}
