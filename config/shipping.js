/**
 * MAH JOY - Shipping Configuration
 * 
 * Weights, dimensions, and origin address for Envia.com integration
 */

module.exports = {
  // Envia.com API Configuration
  envia: {
    apiUrl: 'https://api.envia.com',
    apiToken: 'c541f5b32442e1505448fbdcf85f6cc4ac132a273f148242b8159234fa34432c',
  },

  // Origin address (warehouse/store location)
  origin: {
    name: 'MAH JOY',
    company: 'Play Mahjoy',
    email: 'info@playmahjoy.com',
    phone: '5530395891',
    street: 'Espigas',
    number: '88',
    district: 'Las Fincas',
    city: 'Ciudad Santa Catarina',
    state: 'NL',  // Nuevo León
    country: 'MX',
    postalCode: '66188',
  },

  // Product weights in kg (used for shipping calculations)
  productWeights: {
    // Main products
    'tiles': 2.39,
    'tile': 2.39,
    'sensu': 2.39,
    'mystic': 2.39,
    'cosmic': 2.39,
    
    // Racks
    'rack': 0.55,
    'racks': 0.55,
    
    // Mats
    'mat': 0.81,
    
    // Bags
    'big bag': 0.97,
    'bigbag': 0.97,
    'velvet tile bag': 0.13,
    'tile bag velvet': 0.13,
    'tile bag piel': 0.31,
    'tile case': 0.31,
    'rack bag': 0.12,
    
    // Accessories
    'shuffler': 0.05,
    'line reader': 0.04,
    'folio': 0.11,
    
    // Default for unknown products
    'default': 0.5,
  },

  // Default package dimensions (cm) - can be overridden per product
  defaultDimensions: {
    length: 30,
    width: 25,
    height: 15,
  },

  // Product-specific dimensions (cm)
  productDimensions: {
    'tiles': { length: 35, width: 25, height: 12 },
    'mat': { length: 60, width: 10, height: 10 },
    'rack': { length: 35, width: 8, height: 5 },
    'big bag': { length: 40, width: 30, height: 20 },
  },

  // Confirmed only for this exact cart and market, from the owner's real guide.
  // Other carts require their own measured, approved packing profile.
  packageProfiles: [{
    id: 'mx-mat-polo-rack-green-rack-bag-vino',
    confirmed: true,
    country: 'MX',
    items: [
      { sku: 'MAT-PIEL', qty: 1 },
      { sku: 'RACK-VERDE', qty: 1 },
      { sku: 'RACK-BAG006', qty: 1 },
    ],
    packages: [{
      content: 'Mat Polo Club, Rack Green, Rack Bag Vino',
      type: 'box', amount: 1, weight: 14.79,
      weightUnit: 'KG', lengthUnit: 'CM', insurance: 0,
      dimensions: { length: 83, width: 33, height: 27 },
    }],
  }],

  // Preserve the existing US origin; quote and generation share this source.
  originUS: {
    name: 'Play Mahjoy', company: 'Play Mahjoy',
    email: 'info@playmahjoy.com', phone: '8305551234',
    street: 'Webster St', number: '3267', district: '',
    city: 'Eagle Pass', state: 'TX', country: 'US', postalCode: '78852',
  },
  carriersByCountry: {
    MX: ['fedex', 'dhl', 'estafeta', 'paquetexpress'],
    US: ['usps', 'fedex', 'ups'],
  },

  // Supported carriers (can be filtered)
  carriers: [
    'fedex',
    'dhl',
    'estafeta',
    'redpack',
    'ups',
    '99minutos',
    'paquetexpress',
  ],

  // Countries we ship to
  supportedCountries: ['MX', 'US'],
};
