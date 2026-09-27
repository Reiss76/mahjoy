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
    street: 'Av. Lázaro Cárdenas 2225',
    number: 'PB Local 1-B',
    district: 'Valle Oriente',  // Colonia
    city: 'San Pedro Garza García',
    state: 'NL',  // Nuevo León
    country: 'MX',
    postalCode: '66260',
    reference: 'Torre Latitud',
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
