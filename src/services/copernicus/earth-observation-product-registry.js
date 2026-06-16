const AppError = require('../../utils/app-error');

const TRUE_COLOR_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: ["B04", "B03", "B02", "dataMask"],
    output: { bands: 4 }
  };
}

const maxR = 3.0;
const midR = 0.13;
const sat = 1.2;
const gamma = 1.8;

function evaluatePixel(smp) {
  const rgbLin = satEnh(sAdj(smp.B04), sAdj(smp.B03), sAdj(smp.B02));
  return [sRGB(rgbLin[0]), sRGB(rgbLin[1]), sRGB(rgbLin[2]), smp.dataMask];
}

function sAdj(a) {
  return adjGamma(adj(a, midR, 1, maxR));
}

const gOff = 0.01;
const gOffPow = Math.pow(gOff, gamma);
const gOffRange = Math.pow(1 + gOff, gamma) - gOffPow;

function adjGamma(b) {
  return (Math.pow((b + gOff), gamma) - gOffPow) / gOffRange;
}

function satEnh(r, g, b) {
  const avgS = (r + g + b) / 3.0 * (1 - sat);
  return [clip(avgS + r * sat), clip(avgS + g * sat), clip(avgS + b * sat)];
}

function clip(s) {
  return s < 0 ? 0 : s > 1 ? 1 : s;
}

function adj(a, tx, ty, maxC) {
  var ar = clip(a / maxC, 0, 1);
  return ar * (ar * (tx / maxC + ty - 1) - ty) / (ar * (2 * tx / maxC - 1) - tx / maxC);
}

const sRGB = (c) => c <= 0.0031308 ? (12.92 * c) : (1.055 * Math.pow(c, 0.41666666666) - 0.055);
`;

const CHLA_EVALSCRIPT = `//VERSION 3

var FLAGparam = 0;
var FLAGbackGround = 0;
var NDWI = index(B03, B08);
var Black = [0];
var NDVI = index(B08, B04);
var TrueColor = [B04*2.5, B03*2.5, B02*2.5];

if (B01 == 0 || B03 == 0) {
  var Chl_a = 0;
} else {
  var Chl_a = 4.26 * Math.pow(B03/B01, 3.94);
}

var scaleChl_a = [0, 6, 12, 20, 30, 50];
var s = 255;
var colorScale = [
  [73/s, 111/s, 242/s],
  [130/s, 211/s, 95/s],
  [254/s, 253/s, 5/s],
  [253/s, 0/s, 4/s],
  [142/s, 32/s, 38/s],
  [73/s, 111/s, 242/s]
];

if (NDWI<0) {
  if ( FLAGbackGround == 0 ) {
    return Black;
  } else if ( FLAGbackGround == 1 ) {
    return [0, .5*(NDVI+1), 0];
  } else if ( FLAGbackGround == 2 ) {
    return TrueColor;
  }
} else {
  if (B01 === 0 || B03 === 0 || isNaN(B03/B01)) {
    return [0.5, 0.5, 0.5];
  } else {
    switch ( FLAGparam ) {
      case 0:
      return colorBlend(Chl_a, scaleChl_a, colorScale);
      break;
      default:
        return Black;
    }
  }
}
`;

const CDOM_EVALSCRIPT = `//VERSION 3
var FLAGparam = 3;
var FLAGbackGround = 0;
var NDWI = index(B03, B08);
var Black = [0];
var NDVI = index(B08, B04);
var TrueColor = [B04*2.5, B03*2.5, B02*2.5];

if (B04 == 0) {
  var CDOM = 0;
} else {
  var CDOM = 537 * Math.exp(-2.93*B03/B04);
}

var scaleCDOM  = [0, 1, 2, 3, 4, 5];
var s = 255;
var colorScale = [
  [73/s, 111/s, 242/s],
  [130/s, 211/s, 95/s],
  [254/s, 253/s, 5/s],
  [253/s, 0/s, 4/s],
  [142/s, 32/s, 38/s],
  [217/s, 124/s, 245/s]
];

if (NDWI<0) {
  if ( FLAGbackGround == 0 ) {
    return Black;
  } else if ( FLAGbackGround == 1 ) {
    return [0, 0.5*(NDVI+1), 0];
  } else if ( FLAGbackGround == 2 ) {
    return TrueColor;
  }
} else {
  switch ( FLAGparam ) {
    case 3:
      return colorBlend(CDOM, scaleCDOM, colorScale);
      break;
    default:
      return TrueColor;
  }
}
`;

const TURB_EVALSCRIPT = `//VERSION 3
var FLAGparam = 2;
var FLAGbackGround = 0;
var NDWI = index(B03, B08);
var Black = [0];
var NDVI = index(B08, B04);
var TrueColor = [B04*2.5, B03*2.5, B02*2.5];

if (B01 == 0) {
  var Turb = 0;
} else {
  var Turb = 8.93 * (B03/B01) - 6.39;
}

var scaleTurb  = [0, 4, 8, 12, 16, 20];
var s = 255;
var colorScale = [
  [73/s, 111/s, 242/s],
  [130/s, 211/s, 95/s],
  [254/s, 253/s, 5/s],
  [253/s, 0/s, 4/s],
  [142/s, 32/s, 38/s],
  [217/s, 124/s, 245/s]
];

if (NDWI<0) {
  if ( FLAGbackGround == 0 ) {
    return Black;
  } else if ( FLAGbackGround == 1 ) {
    return [0, .5*(NDVI+1), 0];
  } else if ( FLAGbackGround == 2 ) {
    return TrueColor;
  }
} else {
  if (B01 === 0 || isNaN(B03/B01)) {
    return [0.5, 0.5, 0.5];
  } else {
    switch ( FLAGparam ) {
      case 2:
        return colorBlend(Turb, scaleTurb, colorScale);
        break;
      default:
        return TrueColor;
    }
  }
}
`;

const DOC_EVALSCRIPT = `//VERSION 3
var FLAGparam = 4;
var FLAGbackGround = 0;
var NDWI = index(B03, B08);
var Black = [0];
var NDVI = index(B08, B04);
var TrueColor = [B04*2.5, B03*2.5, B02*2.5];

if (B04 == 0) {
  var DOC = 0;
} else {
  var DOC = 432 * Math.exp(-2.24*B03/B04);
}

var scaleDOC   = [0, 5, 10, 20, 30, 40];
var s = 255;
var colorScale = [
  [73/s, 111/s, 242/s],
  [130/s, 211/s, 95/s],
  [254/s, 253/s, 5/s],
  [253/s, 0/s, 4/s],
  [142/s, 32/s, 38/s],
  [217/s, 124/s, 245/s]
];

if (NDWI<0) {
  if ( FLAGbackGround == 0 ) {
    return Black;
  } else if ( FLAGbackGround == 1 ) {
    return [0, .5*(NDVI+1), 0];
  } else if ( FLAGbackGround == 2 ) {
    return TrueColor;
  }
} else {
  if (B04 === 0 || isNaN(B03/B04)) {
    return [0.5, 0.5, 0.5];
  } else {
    switch ( FLAGparam ) {
      case 4:
        return colorBlend(DOC, scaleDOC, colorScale);
        break;
      default:
        return TrueColor;
    }
  }
}
`;

const CYA_EVALSCRIPT = `//VERSION 3
var FLAGparam = 1;
var FLAGbackGround = 0;
var NDWI = index(B03, B08);
var Black = [0];
var NDVI = index(B08, B04);
var TrueColor = [B04*2.5, B03*2.5, B02*2.5];

if (B02 == 0) {
  var Cya = 0;
} else {
  var Cya = 115530.31 * Math.pow(B03 * B04 / B02, 2.38);
}

var scaleCya   = [0, 10, 20, 40, 50, 100];
var s = 255;
var colorScale = [
  [73/s, 111/s, 242/s],
  [130/s, 211/s, 95/s],
  [254/s, 253/s, 5/s],
  [253/s, 0/s, 4/s],
  [142/s, 32/s, 38/s],
  [73/s, 111/s, 242/s]
];

if (NDWI<0) {
  if ( FLAGbackGround == 0 ) {
    return Black;
  } else if ( FLAGbackGround == 1 ) {
    return [0, .5*(NDVI+1), 0];
  } else if ( FLAGbackGround == 2 ) {
    return TrueColor;
  }
} else {
  if (B01 === 0 || B03 === 0 || isNaN(B03/B01)) {
    return [0.5, 0.5, 0.5];
  } else {
    switch ( FLAGparam ) {
      case 1:
        return colorBlend(Cya, scaleCya, colorScale);
        break;
      default:
        return TrueColor;
    }
  }
}
`;

const SURFACE_TEMPERATURE_EVALSCRIPT = `//VERSION=3
var option = 0;
var minC = 0;
var maxC = 50;
var NDVIs = 0.2;
var NDVIv = 0.8;
var waterE = 0.991;
var soilE = 0.966;
var vegetationE = 0.973;
var C = 0.009;
var bCent = 0.000010854;
var rho = 0.01438;

let viz = ColorRampVisualizer.createRedTemperature(minC, maxC);

function setup() {
  return {
    input: [
      { datasource: "S3SLSTR", bands: ["S8"] },
      { datasource: "S3OLCI", bands: ["B06", "B08", "B17"] }
    ],
    output: [{ id: "default", bands: 3, sampleType: SampleType.AUTO }],
    mosaicking: "ORBIT"
  };
}

function LSEcalc(NDVI, Pv) {
  var LSE;
  if (NDVI < 0) {
    LSE = waterE;
  } else if (NDVI < NDVIs) {
    LSE = soilE;
  } else if (NDVI > NDVIv) {
    LSE = vegetationE;
  } else {
    LSE = vegetationE * Pv + soilE * (1 - Pv) + C;
  }
  return LSE;
}

function evaluatePixel(samples) {
  var LSTmax = -999;
  var LSTavg = 0;
  var reduceNavg = 0;
  var N = samples.S3SLSTR.length;

  for (let i = 0; i < N; i++) {
    var Bi = samples.S3SLSTR[i].S8;
    var B06i = samples.S3OLCI[i].B06;
    var B08i = samples.S3OLCI[i].B08;
    var B17i = samples.S3OLCI[i].B17;

    if (Bi > 173 && Bi < 65000 && B06i > 0 && B08i > 0 && B17i > 0) {
      var S8BTi = Bi - 273.15;
      var NDVIi = (B17i - B08i) / (B17i + B08i);
      var PVi = Math.pow((NDVIi - NDVIs) / (NDVIv - NDVIs), 2);
      var LSEi = LSEcalc(NDVIi, PVi);
      var LSTi = S8BTi / (1 + ((bCent * S8BTi) / rho) * Math.log(LSEi));

      LSTavg = LSTavg + LSTi;
      if (LSTi > LSTmax) {
        LSTmax = LSTi;
      }
    } else {
      ++reduceNavg;
    }
  }

  N = N - reduceNavg;
  if (N <= 0) {
    return [0, 0, 0];
  }

  LSTavg = LSTavg / N;
  let outLST = option == 0 ? LSTavg : LSTmax;
  return viz.process(outLST);
}
`;

class EarthObservationProductRegistry {
  constructor() {
    this.products = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    this.register({
      key: 'true_color',
      collectionLabel: 'sentinel-2-l2a',
      outputFormat: 'image/png',
      fileExtension: 'png',
      dataSources: [{ type: 'sentinel-2-l2a', mosaickingOrder: 'leastCC' }],
      evalscript: TRUE_COLOR_EVALSCRIPT
    });

    this.register({
      key: 'chla',
      collectionLabel: 'sentinel-2-l2a',
      outputFormat: 'image/png',
      fileExtension: 'png',
      dataSources: [{ type: 'sentinel-2-l2a', mosaickingOrder: 'leastCC' }],
      evalscript: CHLA_EVALSCRIPT
    });

    this.registerSentinel2Product('cdom', CDOM_EVALSCRIPT);
    this.registerSentinel2Product('turb', TURB_EVALSCRIPT);
    this.registerSentinel2Product('doc', DOC_EVALSCRIPT);
    this.registerSentinel2Product('cya', CYA_EVALSCRIPT);

    this.register({
      key: 'surface_temperature',
      collectionLabel: 'sentinel-3-slstr+sentinel-3-olci',
      outputFormat: 'image/png',
      fileExtension: 'png',
      dataSources: [
        { id: 'S3SLSTR', type: 'sentinel-3-slstr', maxCloudCoverage: 100 },
        { id: 'S3OLCI', type: 'sentinel-3-olci', maxCloudCoverage: 100 }
      ],
      evalscript: SURFACE_TEMPERATURE_EVALSCRIPT
    });
  }

  register(product) {
    this.products.set(product.key, product);
  }

  registerSentinel2Product(key, evalscript) {
    this.register({
      key,
      collectionLabel: 'sentinel-2-l2a',
      outputFormat: 'image/png',
      fileExtension: 'png',
      dataSources: [{ type: 'sentinel-2-l2a', mosaickingOrder: 'leastCC' }],
      evalscript
    });
  }

  get(key) {
    const product = this.products.get(key);

    if (!product) {
      throw new AppError(`Unsupported image product: ${key}`, 400, 'UNSUPPORTED_PRODUCT');
    }

    return product;
  }

  keys() {
    return Array.from(this.products.keys());
  }
}

module.exports = EarthObservationProductRegistry;
