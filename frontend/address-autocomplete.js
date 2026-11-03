(function (root) {
  'use strict';
  let library;
  function places(key) {
    if (root.google?.maps?.importLibrary) return root.google.maps.importLibrary('places');
    if (library) return library;
    library = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => fail(new Error('Address search timed out.')), 15000);
      function fail(error) { clearTimeout(timer); delete root.h2sAddressPlacesReady; reject(error); }
      root.h2sAddressPlacesReady = async () => {
        clearTimeout(timer); delete root.h2sAddressPlacesReady;
        try { resolve(await root.google.maps.importLibrary('places')); } catch (error) { reject(error); }
      };
      script.async = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&libraries=places&v=weekly&callback=h2sAddressPlacesReady`;
      script.onerror = () => fail(new Error('Address search could not connect.'));
      document.head.append(script);
    });
    return library;
  }
  function splitLine(value) {
    const line = String(value || '');
    const match = /^(.*), ((?:Unit|Apt|Suite) .+|#.+)$/i.exec(line);
    return match ? { street: match[1], unit: match[2].replace(/^Unit /i, '') } : { street: line, unit: '' };
  }
  function addressLine(street, unit) {
    return street ? [street, unit ? (/^(unit|apt|suite)\b|^#/i.test(unit) ? unit : `Unit ${unit}`) : ''].filter(Boolean).join(', ') : '';
  }
  function create(form, config, options = {}) {
    const field = name => form.elements.namedItem(options.fields?.[name] || name);
    const holder = options.holder || form.querySelector('#residential-address-search');
    const status = options.status || form.querySelector('#residential-address-status');
    const details = options.details || form.querySelector('#residential-address-details');
    const unavailable = 'Address search is unavailable. You can enter or keep the details below.';
    let selected = null, selectedFields = '', version = 0, disabled = false, started = false, destroyed = false;
    const fingerprint = () => JSON.stringify(['street', 'city', 'state', 'postalCode'].map(name => field(name).value));
    const changed = () => {
      form.dispatchEvent(new Event('input', { bubbles: true }));
      field('street').dispatchEvent(new Event('change', { bubbles: true }));
    };
    const manual = () => {
      version++; selected = null;
      status.textContent = 'Manual address. Check the details below; suggestions do not verify an address or service coverage.';
      changed();
    };
    for (const name of ['street', 'city', 'state', 'postalCode']) field(name).addEventListener('input', manual);
    async function init() {
      if (started || destroyed || (details && !details.open)) return;
      started = true;
      if (!config?.browserKey) {
        status.textContent = unavailable;
        return;
      }
      status.textContent = 'Loading address search...';
      try {
        const { PlaceAutocompleteElement } = await places(config.browserKey);
        if (destroyed) return;
        const widget = new PlaceAutocompleteElement({
          locationBias: { center: { lat: 34.8526, lng: -82.394 }, radius: 50000 },
        });
        widget.setAttribute('aria-label', 'Find installation address');
        widget.setAttribute('autocomplete', 'off');
        widget.placeholder = 'Search street address';
        widget.style.width = '100%';
        holder.append(widget); holder.inert = disabled;
        widget.addEventListener('input', manual);
        widget.addEventListener('gmp-error', () => {
          version++; selected = null;
          status.textContent = unavailable;
          changed();
        });
        widget.addEventListener('gmp-select', async ({ placePrediction }) => {
          if (disabled) return;
          selected = null;
          const current = ++version;
          status.textContent = 'Loading selected address...';
          try {
            const place = placePrediction.toPlace();
            await place.fetchFields({ fields: ['id', 'addressComponents'] });
            if (disabled || current !== version) return;
            const component = (type, short = false) => {
              const value = place.addressComponents?.find(item => item.types.includes(type));
              return (short ? value?.shortText : value?.longText) || '';
            };
            const values = {
              street: [component('street_number'), component('route')].filter(Boolean).join(' '),
              unit: component('subpremise'),
              city: component('locality') || component('postal_town') || component('sublocality_level_1'),
              state: component('administrative_area_level_1', true),
              postalCode: [component('postal_code'), component('postal_code_suffix')].filter(Boolean).join('-'),
            };
            for (const [name, value] of Object.entries(values)) if (value) field(name).value = value;
            selected = place.id && ['street', 'city', 'state', 'postalCode'].every(name => values[name])
              ? { source: 'google_places', placeId: place.id } : null;
            selectedFields = fingerprint();
            status.textContent = 'Address suggestion selected. Check the details; service coverage is confirmed during follow-up.';
            changed();
          } catch (error) {
            if (current !== version || disabled) return;
            selected = null;
            status.textContent = `${error.message || 'Selected address could not load.'} Enter details below instead.`;
          }
        });
        status.textContent = 'Search with Google or enter details below. Suggestions do not confirm service coverage.';
      } catch (error) {
        status.textContent = `${error.message || 'Address search is unavailable.'} Enter details below, or leave just your city.`;
      }
    }
    details?.addEventListener('toggle', init);
    if (!options.defer) init();
    return {
      activate: init,
      read() {
        const address = Object.fromEntries(['street', 'unit', 'city', 'state', 'postalCode'].map(name => [name, field(name).value.trim()]));
        if (!['street', 'unit', 'state', 'postalCode'].some(name => address[name])) return undefined;
        return { ...address, addressLine: addressLine(address.street, address.unit),
          ...(selected && selectedFields === fingerprint() ? selected : { source: 'manual' }) };
      },
      restore(value = {}) {
        version++;
        selected = value.source === 'google_places' && value.placeId ? { source: value.source, placeId: value.placeId } : null;
        for (const name of ['street', 'unit', 'city', 'state', 'postalCode']) {
          if (typeof value[name] === 'string') field(name).value = value[name];
        }
        selectedFields = fingerprint();
      },
      setDisabled(value) { disabled = value; version++; holder.inert = value; },
      destroy() {
        destroyed = true; disabled = true; version++;
        details?.removeEventListener('toggle', init);
        for (const name of ['street', 'city', 'state', 'postalCode']) field(name).removeEventListener('input', manual);
      },
    };
  }
  root.H2SAddressAutocomplete = { create, splitLine, addressLine };
})(typeof globalThis !== 'undefined' ? globalThis : this);
