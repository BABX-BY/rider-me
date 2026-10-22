// Presentation fixtures only. Never submit these records to the API or Neon.
// Values, distances and ETAs are fixed examples, not optimizer output.
export interface PreviewStop {
  id: number;
  sequence: number;
  customer: string;
  address: string;
  boxes: number;
  latitude: number;
  longitude: number;
  eta: string;
}

export interface PreviewRoute {
  id: number;
  name: string;
  plate: string;
  color: string;
  totalBoxes: number;
  distanceKm: string;
  durationMinutes: number;
  lastArrival: string;
  stops: readonly PreviewStop[];
}

export const PREVIEW_STORE = {
  name: 'ร้านข้าวกล่องจำลอง มมส.',
  latitude: 16.244335,
  longitude: 103.2494546,
} as const;

export const PREVIEW_ROUTES: readonly PreviewRoute[] = [
  {
    id: 1,
    name: 'ไรเดอร์ตัวอย่าง A',
    plate: 'ทด 1001',
    color: '#d94c60',
    totalBoxes: 6,
    distanceKm: '2.8',
    durationMinutes: 16,
    lastArrival: '11:43',
    stops: [
      {
        id: 101,
        sequence: 1,
        customer: 'ลูกค้าตัวอย่าง 01',
        address: 'หอพักฝั่งตะวันตก จุดสาธิต A1',
        boxes: 2,
        latitude: 16.24285,
        longitude: 103.24295,
        eta: '11:35',
      },
      {
        id: 102,
        sequence: 2,
        customer: 'ลูกค้าตัวอย่าง 02',
        address: 'ชุมชนขามเรียง จุดสาธิต A2',
        boxes: 1,
        latitude: 16.2420625,
        longitude: 103.2434375,
        eta: '11:39',
      },
      {
        id: 103,
        sequence: 3,
        customer: 'ลูกค้าตัวอย่าง 03',
        address: 'อรัญชัยแกรนด์ จุดสาธิต A3',
        boxes: 3,
        latitude: 16.2408125,
        longitude: 103.2440625,
        eta: '11:43',
      },
    ],
  },
  {
    id: 2,
    name: 'ไรเดอร์ตัวอย่าง B',
    plate: 'ทด 1002',
    color: '#168568',
    totalBoxes: 6,
    distanceKm: '3.4',
    durationMinutes: 19,
    lastArrival: '11:46',
    stops: [
      {
        id: 201,
        sequence: 1,
        customer: 'ลูกค้าตัวอย่าง 04',
        address: 'ย่านพักอาศัยทิศเหนือ จุดสาธิต B1',
        boxes: 3,
        latitude: 16.2492,
        longitude: 103.2471,
        eta: '11:36',
      },
      {
        id: 202,
        sequence: 2,
        customer: 'ลูกค้าตัวอย่าง 05',
        address: 'ย่านพักอาศัยทิศเหนือ จุดสาธิต B2',
        boxes: 2,
        latitude: 16.253,
        longitude: 103.2496,
        eta: '11:41',
      },
      {
        id: 203,
        sequence: 3,
        customer: 'ลูกค้าตัวอย่าง 06',
        address: 'ย่านพักอาศัยทิศเหนือ จุดสาธิต B3',
        boxes: 1,
        latitude: 16.2508,
        longitude: 103.2543,
        eta: '11:46',
      },
    ],
  },
  {
    id: 3,
    name: 'ไรเดอร์ตัวอย่าง C',
    plate: 'ทด 1003',
    color: '#4873cf',
    totalBoxes: 6,
    distanceKm: '4.2',
    durationMinutes: 22,
    lastArrival: '11:49',
    stops: [
      {
        id: 301,
        sequence: 1,
        customer: 'ลูกค้าตัวอย่าง 07',
        address: 'ย่านท่าขอนยาง จุดสาธิต C1',
        boxes: 1,
        latitude: 16.2425,
        longitude: 103.2562,
        eta: '11:37',
      },
      {
        id: 302,
        sequence: 2,
        customer: 'ลูกค้าตัวอย่าง 08',
        address: 'ย่านท่าขอนยาง จุดสาธิต C2',
        boxes: 3,
        latitude: 16.2391,
        longitude: 103.2605,
        eta: '11:43',
      },
      {
        id: 303,
        sequence: 3,
        customer: 'ลูกค้าตัวอย่าง 09',
        address: 'ย่านท่าขอนยาง จุดสาธิต C3',
        boxes: 2,
        latitude: 16.23661,
        longitude: 103.26338,
        eta: '11:49',
      },
    ],
  },
];
