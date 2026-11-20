import { DomainCategory, DomainMetadata } from '../types/telemetry';

export const UNIVERSAL_DOMAINS: Record<DomainCategory, DomainMetadata> = {
  weather: {
    id: 'weather',
    name: 'Weather Intelligence',
    description: 'Meteorological observations, atmospheric pressure, thermal profiles, wind velocity, precipitation, and multi-model forecast streams.',
    priorityGroup: 'Phase 1 Core',
    isPhase1Priority: true,
    colorHex: '#06b6d4',
    iconName: 'CloudSun',
    primaryUnit: '°C / hPa / m/s',
    sampleMeasurementIds: ['air_temperature', 'relative_humidity', 'surface_pressure', 'wind_speed', 'precipitation']
  },
  environmental: {
    id: 'environmental',
    name: 'Environmental Intelligence',
    description: 'Air Quality Index (AQI), PM2.5/PM10 particulate densities, CO2 concentration, ambient noise acoustic levels, and eco-sensors.',
    priorityGroup: 'Phase 1 Core',
    isPhase1Priority: true,
    colorHex: '#10b981',
    iconName: 'Leaf',
    primaryUnit: 'µg/m³ / ppm / dBA',
    sampleMeasurementIds: ['pm2_5', 'pm10', 'carbon_dioxide', 'noise_level']
  },
  geographic: {
    id: 'geographic',
    name: 'Geographic Intelligence',
    description: 'Geospatial coordinates, elevation maps, spatial boundary vectors, distance calculations, and regional GIS overlays.',
    priorityGroup: 'Phase 1 Core',
    isPhase1Priority: true,
    colorHex: '#3b82f6',
    iconName: 'Globe',
    primaryUnit: 'EPSG:4326 / m',
    sampleMeasurementIds: ['latitude', 'longitude', 'elevation', 'distance']
  },
  energy: {
    id: 'energy',
    name: 'Energy Intelligence',
    description: 'Electricity grid generation/consumption, solar panel output kW, grid AC frequency Hz, phase voltage, and demand forecasts.',
    priorityGroup: 'Phase 1 Core',
    isPhase1Priority: true,
    colorHex: '#f59e0b',
    iconName: 'Zap',
    primaryUnit: 'kW / Hz / V',
    sampleMeasurementIds: ['power', 'energy', 'frequency', 'voltage', 'solar_generation']
  },
  computing: {
    id: 'computing',
    name: 'Computing Intelligence',
    description: 'CPU utilization %, RAM pressure %, disk I/O throughput MB/s, active processes, OpenTelemetry traces, and system health.',
    priorityGroup: 'Phase 1 Core',
    isPhase1Priority: true,
    colorHex: '#6366f1',
    iconName: 'Cpu',
    primaryUnit: '% / ms / MB/s',
    sampleMeasurementIds: ['cpu_usage', 'memory_usage', 'disk_io', 'application_latency']
  },
  audio: {
    id: 'audio',
    name: 'Audio Intelligence',
    description: 'Real-time WebAudio DSP signal processing, peak/RMS levels dB, FFT spectral centroid, harmonicity ratio, and LUFS loudness.',
    priorityGroup: 'Phase 1 Core',
    isPhase1Priority: true,
    colorHex: '#8b5cf6',
    iconName: 'Volume2',
    primaryUnit: 'dBFS / Hz / LUFS',
    sampleMeasurementIds: ['peak_amplitude', 'rms_level', 'spectral_centroid', 'loudness_lufs']
  },
  musical: {
    id: 'musical',
    name: 'Musical Intelligence',
    description: 'Tempo detection (BPM), musical key/scale tracking, onset strength, Web MIDI event stream ingestion, and harmonic sonification.',
    priorityGroup: 'Phase 1 Core',
    isPhase1Priority: true,
    colorHex: '#ec4899',
    iconName: 'Music',
    primaryUnit: 'BPM / Pitch / MIDI',
    sampleMeasurementIds: ['tempo_bpm', 'pitch_hz', 'onset_strength', 'midi_note']
  },
  atmospheric: {
    id: 'atmospheric',
    name: 'Atmospheric Intelligence',
    description: 'Stratospheric ozone, aerosol optical depth, boundary layer height, greenhouse gas column concentrations.',
    priorityGroup: 'Next Expansion',
    isPhase1Priority: false,
    colorHex: '#0284c7',
    iconName: 'Wind',
    primaryUnit: 'hPa / ppm / m',
    sampleMeasurementIds: ['atmospheric_pressure', 'dew_point', 'boundary_layer_height']
  },
  geological: {
    id: 'geological',
    name: 'Geological Intelligence',
    description: 'Tectonic strain vectors, seismic magnitude, fault displacement, magnetic anomaly maps.',
    priorityGroup: 'Next Expansion',
    isPhase1Priority: false,
    colorHex: '#78350f',
    iconName: 'Activity',
    primaryUnit: 'Richter / mm / km',
    sampleMeasurementIds: ['earthquake_magnitude', 'seismic_acceleration', 'depth']
  },
  oceanographic: {
    id: 'oceanographic',
    name: 'Oceanographic Intelligence',
    description: 'Sea surface temperature (SST), significant wave height, salinity PSU, thermocline depth.',
    priorityGroup: 'Next Expansion',
    isPhase1Priority: false,
    colorHex: '#0891b2',
    iconName: 'Waves',
    primaryUnit: '°C / m / PSU',
    sampleMeasurementIds: ['sea_surface_temperature', 'wave_height', 'salinity']
  },
  solar: {
    id: 'solar',
    name: 'Solar Intelligence',
    description: 'Sunspot count, solar radio flux F10.7, coronal mass ejection tracking, solar flare classification.',
    priorityGroup: 'Following Expansion',
    isPhase1Priority: false,
    colorHex: '#eab308',
    iconName: 'Sun',
    primaryUnit: 'W/m² / SFU',
    sampleMeasurementIds: ['solar_irradiance', 'sunspot_number', 'solar_flare_class']
  },
  space: {
    id: 'space',
    name: 'Space Intelligence',
    description: 'Geomagnetic K-index, cosmic ray flux counts, satellite orbital decay rate, space debris tracking.',
    priorityGroup: 'Following Expansion',
    isPhase1Priority: false,
    colorHex: '#a855f7',
    iconName: 'Orbit',
    primaryUnit: 'Kp / km',
    sampleMeasurementIds: ['satellite_position', 'orbital_altitude', 'radiation_flux']
  },
  biological: {
    id: 'biological',
    name: 'Biological Intelligence',
    description: 'Normalized Difference Vegetation Index (NDVI), eco-acoustic species count, bio-luminescence flux.',
    priorityGroup: 'Following Expansion',
    isPhase1Priority: false,
    colorHex: '#22c55e',
    iconName: 'TreePine',
    primaryUnit: 'Index / Count',
    sampleMeasurementIds: ['biodiversity_index', 'biomass', 'growth_rate']
  },
  agricultural: {
    id: 'agricultural',
    name: 'Agricultural Intelligence',
    description: 'Volumetric soil water content, evapotranspiration rates (ET0), crop stress index, soil temperature.',
    priorityGroup: 'Next Expansion',
    isPhase1Priority: false,
    colorHex: '#65a30d',
    iconName: 'Wheat',
    primaryUnit: '% / °C / mm',
    sampleMeasurementIds: ['soil_moisture', 'soil_temperature', 'evapotranspiration']
  },
  industrial: {
    id: 'industrial',
    name: 'Industrial Intelligence',
    description: 'Turbine vibration acceleration, bearing temperature, hydraulic pressure, pump flow rate.',
    priorityGroup: 'Next Expansion',
    isPhase1Priority: false,
    colorHex: '#d97706',
    iconName: 'Factory',
    primaryUnit: '°C / bar / Count',
    sampleMeasurementIds: ['machine_temperature', 'machine_vibration', 'flow_rate']
  },
  smart_building: {
    id: 'smart_building',
    name: 'Smart Building Intelligence',
    description: 'HVAC airflow CFM, zone thermal comfort PMV, occupant count, indoor CO2 level.',
    priorityGroup: 'Next Expansion',
    isPhase1Priority: false,
    colorHex: '#14b8a6',
    iconName: 'Building',
    primaryUnit: '°C / ppm / Count',
    sampleMeasurementIds: ['indoor_temperature', 'occupancy_count', 'co2_level']
  },
  transport: {
    id: 'transport',
    name: 'Transport Intelligence',
    description: 'Urban traffic density, fleet velocity, corridor congestion index, transit arrival variance.',
    priorityGroup: 'Following Expansion',
    isPhase1Priority: false,
    colorHex: '#f97316',
    iconName: 'Truck',
    primaryUnit: 'km/h / Count / Sec',
    sampleMeasurementIds: ['vehicle_speed', 'traffic_density', 'travel_time']
  },
  network: {
    id: 'network',
    name: 'Network Intelligence',
    description: 'Packet jitter ms, optical signal-to-noise ratio OSNR, BGP route flap rate, link saturation %.',
    priorityGroup: 'Following Expansion',
    isPhase1Priority: false,
    colorHex: '#06b6d4',
    iconName: 'Network',
    primaryUnit: 'ms / % / Gbps',
    sampleMeasurementIds: ['latency', 'packet_loss', 'bandwidth', 'jitter']
  },
  financial: {
    id: 'financial',
    name: 'Financial Intelligence',
    description: 'Asset spot prices, implied volatility index (VIX), order book bid/ask spread, order velocity.',
    priorityGroup: 'Following Expansion',
    isPhase1Priority: false,
    colorHex: '#10b981',
    iconName: 'TrendingUp',
    primaryUnit: 'USD / Vol % / bps',
    sampleMeasurementIds: ['asset_price', 'trade_volume', 'volatility']
  },
  economic: {
    id: 'economic',
    name: 'Economic Intelligence',
    description: 'Consumer Price Index (CPI), sovereign yield curve spread (10Y-2Y), purchasing managers index (PMI).',
    priorityGroup: 'Later Expansion',
    isPhase1Priority: false,
    colorHex: '#059669',
    iconName: 'DollarSign',
    primaryUnit: 'YoY % / bps / Index',
    sampleMeasurementIds: ['inflation_rate', 'gross_domestic_product', 'consumer_price_index']
  },
  business: {
    id: 'business',
    name: 'Business Intelligence',
    description: 'Daily active subscription churn, net revenue retention (NRR), inventory velocity, lead cycle time.',
    priorityGroup: 'Later Expansion',
    isPhase1Priority: false,
    colorHex: '#6366f1',
    iconName: 'Briefcase',
    primaryUnit: 'USD / Count / %',
    sampleMeasurementIds: ['revenue', 'order_count', 'customer_count']
  },
  social_information: {
    id: 'social_information',
    name: 'Social and Information Intelligence',
    description: 'Global news sentiment index (-1 to +1), search term momentum, cross-network message velocity.',
    priorityGroup: 'Later Expansion',
    isPhase1Priority: false,
    colorHex: '#8b5cf6',
    iconName: 'MessageSquare',
    primaryUnit: 'Score / Count',
    sampleMeasurementIds: ['sentiment_score', 'mention_count', 'trend_velocity']
  },
  artificial_intelligence: {
    id: 'artificial_intelligence',
    name: 'Artificial Intelligence',
    description: 'Model inference latency ms, token generation velocity, vector embedding distance drift, KV-cache pressure.',
    priorityGroup: 'Later Expansion',
    isPhase1Priority: false,
    colorHex: '#d946ef',
    iconName: 'Bot',
    primaryUnit: 'ms / tok/s / %',
    sampleMeasurementIds: ['inference_latency', 'token_count', 'throughput', 'model_accuracy']
  },
  security: {
    id: 'security',
    name: 'Security Intelligence',
    description: 'Authentication failure spike rate, firewall anomaly triggers, API token unauthorized attempt count.',
    priorityGroup: 'Later Expansion',
    isPhase1Priority: false,
    colorHex: '#f43f5e',
    iconName: 'ShieldAlert',
    primaryUnit: 'Count / Score',
    sampleMeasurementIds: ['failed_login_count', 'threat_score', 'vulnerability_count']
  }
};

export const PHASE_1_DOMAINS = Object.values(UNIVERSAL_DOMAINS).filter(d => d.isPhase1Priority);
export const ALL_DOMAINS_LIST = Object.values(UNIVERSAL_DOMAINS);
