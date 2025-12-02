import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { AlertTriangle, Calendar, Wrench, AlertCircle } from 'lucide-react';

// Placeholder/mock data (replace with selectors or hooks as needed)
const vehicles = [
  {
    year: 2010,
    reg: 'NJ10 TKV',
    driver: 'Andy Hill',
    brand: 'Ford',
    model: 'Fiesta',
    presentMileage: 131221,
    milesNextService: 141000,
    milesLastService: 130883,
    milesDueCambelt: 117000,
    cambeltDone: 'Yes',
    fireExtinguisher: 'OK',
    firstAidCheck: 'OK',
    comments: 'All good',
    hardwareId: '359632101991609',
    motDateDue: '2026-07-12',
    taxDateDue: '2026-02-15',
    defects1: 'None',
    defects2: 'Light bulb',
    defects3: '-',
    defects4: '-',
  },
  {
    year: 2001,
    reg: 'Y207 GAU',
    driver: 'SPARE',
    brand: 'Peugeot',
    model: 'Partner',
    presentMileage: 141086,
    milesNextService: 146000,
    milesLastService: 136989,
    milesDueCambelt: 150000,
    cambeltDone: 'No',
    fireExtinguisher: 'OK',
    firstAidCheck: 'OK',
    comments: 'Spare vehicle',
    hardwareId: '359632101984091',
    motDateDue: '2026-05-20',
    taxDateDue: '2026-01-10',
    defects1: 'None',
    defects2: '-',
    defects3: '-',
    defects4: '-',
  },
  {
    year: 2011,
    reg: 'FG11 OYX',
    driver: 'Sarah Hubbard',
    brand: 'Vauxhall',
    model: 'Corsa',
    presentMileage: 163068,
    milesNextService: 161000, // OVERDUE (current mileage exceeds service mileage)
    milesLastService: 151000,
    milesDueCambelt: 180000,
    cambeltDone: 'No',
    fireExtinguisher: 'OK',
    firstAidCheck: 'Needs replacement',
    comments: 'Service overdue',
    hardwareId: '354018118074131',
    motDateDue: '2025-12-10', // DUE SOON (10 days)
    taxDateDue: '2025-12-05', // OVERDUE
    defects1: 'Windscreen chip',
    defects2: '-',
    defects3: '-',
    defects4: 'Wiper blade worn',
  },
  {
    year: 2015,
    reg: 'BD15 XYZ',
    driver: 'Tom Squires',
    brand: 'Volkswagen',
    model: 'Transporter',
    presentMileage: 87420,
    milesNextService: 95000,
    milesLastService: 85000,
    milesDueCambelt: 120000,
    cambeltDone: 'No',
    fireExtinguisher: 'OK',
    firstAidCheck: 'OK',
    comments: 'Good condition',
    hardwareId: '359632101772456',
    motDateDue: '2026-09-10',
    taxDateDue: '2026-04-01',
    defects1: 'None',
    defects2: 'None',
    defects3: 'Tyre pressure low',
    defects4: '-',
  },
  {
    year: 2018,
    reg: 'CX18 LMN',
    driver: 'Peter Woodward',
    brand: 'Mercedes',
    model: 'Sprinter',
    presentMileage: 63200,
    milesNextService: 70000,
    milesLastService: 60000,
    milesDueCambelt: 100000,
    cambeltDone: 'No',
    fireExtinguisher: 'OK',
    firstAidCheck: 'OK',
    comments: 'Recent inspection OK',
    hardwareId: '359632101889231',
    motDateDue: '2026-11-20',
    taxDateDue: '2026-06-15',
    defects1: 'None',
    defects2: 'None',
    defects3: '-',
    defects4: '-',
  },
  {
    year: 2012,
    reg: 'HJ12 ABC',
    driver: 'SPARE',
    brand: 'Citroen',
    model: 'Berlingo',
    presentMileage: 154300,
    milesNextService: 160000,
    milesLastService: 150000,
    milesDueCambelt: 152000, // OVERDUE (current mileage exceeds cambelt due)
    cambeltDone: 'No',
    fireExtinguisher: 'Expired', // OVERDUE
    firstAidCheck: 'OK',
    comments: 'Needs fire extinguisher service & cambelt URGENT',
    hardwareId: '359632101663478',
    motDateDue: '2025-12-20', // DUE SOON (18 days)
    taxDateDue: '2025-11-28', // OVERDUE
    defects1: 'Brake wear',
    defects2: '-',
    defects3: '-',
    defects4: '-',
  },
  {
    year: 2016,
    reg: 'LK16 QRS',
    driver: 'James Mitchell',
    brand: 'Ford',
    model: 'Transit',
    presentMileage: 99200,
    milesNextService: 100000, // DUE SOON (800 miles to go)
    milesLastService: 90000,
    milesDueCambelt: 125000,
    cambeltDone: 'No',
    fireExtinguisher: 'OK',
    firstAidCheck: 'OK',
    comments: 'Service due soon',
    hardwareId: '359632101557892',
    motDateDue: '2025-12-25', // DUE SOON (23 days)
    taxDateDue: '2026-01-10',
    defects1: 'None',
    defects2: 'None',
    defects3: '-',
    defects4: '-',
  },
  {
    year: 2019,
    reg: 'MN19 DEF',
    driver: 'Emma Clarke',
    brand: 'Nissan',
    model: 'NV200',
    presentMileage: 48900,
    milesNextService: 55000,
    milesLastService: 45000,
    milesDueCambelt: 90000,
    cambeltDone: 'No',
    fireExtinguisher: 'OK',
    firstAidCheck: 'OK',
    comments: 'Low mileage, excellent condition',
    hardwareId: '359632101445678',
    motDateDue: '2026-12-10',
    taxDateDue: '2026-07-05',
    defects1: 'None',
    defects2: 'None',
    defects3: 'None',
    defects4: '-',
  },
  {
    year: 2014,
    reg: 'OP14 GHI',
    driver: 'David Roberts',
    brand: 'Renault',
    model: 'Kangoo',
    presentMileage: 118700,
    milesNextService: 125000,
    milesLastService: 115000,
    milesDueCambelt: 140000,
    cambeltDone: 'Yes',
    fireExtinguisher: 'OK',
    firstAidCheck: 'OK',
    comments: 'Regular maintenance',
    hardwareId: '359632101334512',
    motDateDue: '2026-04-22',
    taxDateDue: '2026-01-18',
    defects1: 'None',
    defects2: 'Minor oil leak',
    defects3: '-',
    defects4: '-',
  },
  {
    year: 2017,
    reg: 'RS17 JKL',
    driver: 'Sophie Williams',
    brand: 'Peugeot',
    model: 'Expert',
    presentMileage: 76500,
    milesNextService: 85000,
    milesLastService: 75000,
    milesDueCambelt: 110000,
    cambeltDone: 'No',
    fireExtinguisher: 'OK',
    firstAidCheck: 'OK',
    comments: 'Recently serviced',
    hardwareId: '359632101223489',
    motDateDue: '2026-10-14',
    taxDateDue: '2026-05-08',
    defects1: 'None',
    defects2: 'None',
    defects3: 'None',
    defects4: 'Headlight alignment',
  },
];

// Helper functions for color coding and status
const getDaysUntil = (dateString: string) => {
  const today = new Date();
  const targetDate = new Date(dateString);
  const diffTime = targetDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

const getMilesUntil = (currentMileage: number, targetMileage: number) => {
  return targetMileage - currentMileage;
};

const getStatusColor = (value: number, type: 'days' | 'miles') => {
  if (value < 0) return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'; // Overdue
  if (type === 'days' && value <= 30) return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20'; // Due soon
  if (type === 'miles' && value <= 1000) return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20'; // Due soon
  return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'; // OK
};

const getDateStatusColor = (dateString: string) => {
  const daysUntil = getDaysUntil(dateString);
  return getStatusColor(daysUntil, 'days');
};

const getMileageStatusColor = (currentMileage: number, targetMileage: number) => {
  const milesUntil = getMilesUntil(currentMileage, targetMileage);
  return getStatusColor(milesUntil, 'miles');
};

const getItemStatusColor = (item: string) => {
  if (item === 'Expired' || item === 'Needs replacement') {
    return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20';
  }
  return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20';
};

export default function MaintenanceDemoPage() {
  // Calculate upcoming/overdue tasks
  const alerts = vehicles.flatMap((v) => {
    const tasks = [];
    
    // Check service
    const milesUntilService = getMilesUntil(v.presentMileage, v.milesNextService);
    if (milesUntilService < 1000) {
      tasks.push({
        vehicle: v.reg,
        type: milesUntilService < 0 ? 'overdue' : 'due-soon',
        task: 'Service',
        detail: milesUntilService < 0 
          ? `${Math.abs(milesUntilService).toLocaleString()} miles overdue` 
          : `${milesUntilService.toLocaleString()} miles remaining`,
      });
    }
    
    // Check cambelt
    if (v.cambeltDone === 'No') {
      const milesUntilCambelt = getMilesUntil(v.presentMileage, v.milesDueCambelt);
      if (milesUntilCambelt < 5000) {
        tasks.push({
          vehicle: v.reg,
          type: milesUntilCambelt < 0 ? 'overdue' : 'due-soon',
          task: 'Cambelt replacement',
          detail: milesUntilCambelt < 0 
            ? `${Math.abs(milesUntilCambelt).toLocaleString()} miles overdue` 
            : `${milesUntilCambelt.toLocaleString()} miles remaining`,
        });
      }
    }
    
    // Check MOT
    const daysUntilMOT = getDaysUntil(v.motDateDue);
    if (daysUntilMOT < 30) {
      tasks.push({
        vehicle: v.reg,
        type: daysUntilMOT < 0 ? 'overdue' : 'due-soon',
        task: 'MOT',
        detail: daysUntilMOT < 0 
          ? `${Math.abs(daysUntilMOT)} days overdue` 
          : `Due in ${daysUntilMOT} days`,
      });
    }
    
    // Check TAX
    const daysUntilTAX = getDaysUntil(v.taxDateDue);
    if (daysUntilTAX < 30) {
      tasks.push({
        vehicle: v.reg,
        type: daysUntilTAX < 0 ? 'overdue' : 'due-soon',
        task: 'TAX',
        detail: daysUntilTAX < 0 
          ? `${Math.abs(daysUntilTAX)} days overdue` 
          : `Due in ${daysUntilTAX} days`,
      });
    }
    
    // Check fire extinguisher
    if (v.fireExtinguisher === 'Expired') {
      tasks.push({
        vehicle: v.reg,
        type: 'overdue',
        task: 'Fire extinguisher',
        detail: 'Expired',
      });
    }
    
    // Check first aid
    if (v.firstAidCheck === 'Needs replacement') {
      tasks.push({
        vehicle: v.reg,
        type: 'overdue',
        task: 'First aid kit',
        detail: 'Needs replacement',
      });
    }
    
    return tasks;
  });

  const overdueAlerts = alerts.filter(a => a.type === 'overdue');
  const dueSoonAlerts = alerts.filter(a => a.type === 'due-soon');

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Vehicle Maintenance Log</h1>
            <p className="text-slate-600 dark:text-slate-400">
              Demo: Choose a layout style below
            </p>
          </div>
        </div>
      </div>

      {/* Alerts Summary */}
      {(overdueAlerts.length > 0 || dueSoonAlerts.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Overdue Tasks */}
          {overdueAlerts.length > 0 && (
            <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                  <CardTitle className="text-lg text-red-900 dark:text-red-100">Overdue Tasks</CardTitle>
                </div>
                <CardDescription className="text-red-700 dark:text-red-300">
                  {overdueAlerts.length} task{overdueAlerts.length !== 1 ? 's' : ''} requiring immediate attention
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {overdueAlerts.map((alert, idx) => (
                    <div key={idx} className="flex items-start gap-3 text-sm bg-white dark:bg-slate-900 p-3 rounded-md border border-red-200 dark:border-red-800">
                      <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="font-semibold text-red-900 dark:text-red-100">{alert.vehicle} - {alert.task}</div>
                        <div className="text-red-700 dark:text-red-300">{alert.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Due Soon Tasks */}
          {dueSoonAlerts.length > 0 && (
            <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <CardTitle className="text-lg text-amber-900 dark:text-amber-100">Due Soon</CardTitle>
                </div>
                <CardDescription className="text-amber-700 dark:text-amber-300">
                  {dueSoonAlerts.length} task{dueSoonAlerts.length !== 1 ? 's' : ''} coming up
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {dueSoonAlerts.map((alert, idx) => (
                    <div key={idx} className="flex items-start gap-3 text-sm bg-white dark:bg-slate-900 p-3 rounded-md border border-amber-200 dark:border-amber-800">
                      <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="font-semibold text-amber-900 dark:text-amber-100">{alert.vehicle} - {alert.task}</div>
                        <div className="text-amber-700 dark:text-amber-300">{alert.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Tabs defaultValue="table" className="space-y-4">
        <TabsList className="bg-slate-100 dark:bg-slate-800">
          <TabsTrigger value="table">Table View</TabsTrigger>
          <TabsTrigger value="card">Card View</TabsTrigger>
          <TabsTrigger value="form">Form Layout</TabsTrigger>
        </TabsList>

        <TabsContent value="table" className="space-y-4">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-slate-900 dark:text-white">Tabular Log</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-400">
                    Classic spreadsheet-style, suitable for bulk viewing.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/50">
                      <TableHead className="text-slate-700 dark:text-slate-300">Year</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Reg No.</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Driver</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Brand</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Model</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Mileage</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Next Service</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Last Service</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Cambelt Due</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Cambelt Done</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">MOT Due</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">TAX Due</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">1wk Defects</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">2wk Defects</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">3wk Defects</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">4wk Defects</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Fire Ext.</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">First Aid</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Comments</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Hardware ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vehicles.map((v) => (
                      <TableRow key={v.reg} className="border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <TableCell className="text-slate-700 dark:text-slate-300">{v.year}</TableCell>
                        <TableCell className="font-medium text-slate-900 dark:text-white">{v.reg}</TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">{v.driver}</TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">{v.brand}</TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">{v.model}</TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">{v.presentMileage.toLocaleString()}</TableCell>
                        <TableCell className={`font-medium px-2 py-1 rounded ${getMileageStatusColor(v.presentMileage, v.milesNextService)}`}>
                          {v.milesNextService.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">{v.milesLastService.toLocaleString()}</TableCell>
                        <TableCell className={`font-medium px-2 py-1 rounded ${getMileageStatusColor(v.presentMileage, v.milesDueCambelt)}`}>
                          {v.milesDueCambelt.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">{v.cambeltDone}</TableCell>
                        <TableCell className={`font-medium px-2 py-1 rounded ${getDateStatusColor(v.motDateDue)}`}>
                          {v.motDateDue}
                        </TableCell>
                        <TableCell className={`font-medium px-2 py-1 rounded ${getDateStatusColor(v.taxDateDue)}`}>
                          {v.taxDateDue}
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">{v.defects1}</TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">{v.defects2}</TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">{v.defects3}</TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">{v.defects4}</TableCell>
                        <TableCell className={`font-medium px-2 py-1 rounded ${getItemStatusColor(v.fireExtinguisher)}`}>
                          {v.fireExtinguisher}
                        </TableCell>
                        <TableCell className={`font-medium px-2 py-1 rounded ${getItemStatusColor(v.firstAidCheck)}`}>
                          {v.firstAidCheck}
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">{v.comments}</TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300 text-xs">{v.hardwareId}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-6 flex gap-4">
                <Button disabled className="bg-blue-600 hover:bg-blue-700 opacity-50 cursor-not-allowed">Add Row</Button>
                <Button disabled className="bg-slate-600 hover:bg-slate-700 opacity-50 cursor-not-allowed">Edit Selected</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="card" className="space-y-4">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-slate-900 dark:text-white">Card View</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-400">
                    One card per vehicle – easy to browse for visual and mobile users.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {vehicles.map((v) => (
                  <Card key={v.reg} className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 shadow-md hover:shadow-lg transition-shadow">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg text-slate-900 dark:text-white flex items-start gap-2 flex-wrap">
                        {v.year} – {v.reg}
                      </CardTitle>
                      <div className="flex gap-2 flex-wrap mt-2">
                        <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100">
                          {v.brand} {v.model}
                        </Badge>
                      </div>
                      <CardDescription className="text-slate-600 dark:text-slate-400 text-sm mt-2">
                        Driver: <span className="font-medium">{v.driver}</span>
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="grid gap-2 text-slate-700 dark:text-slate-300">
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Mileage:</span>
                          <span className="font-semibold">{v.presentMileage.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-600 dark:text-slate-400">MOT Due:</span>
                          <Badge className={`font-semibold ${getDateStatusColor(v.motDateDue)}`}>
                            {v.motDateDue}
                          </Badge>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-600 dark:text-slate-400">Tax Due:</span>
                          <Badge className={`font-semibold ${getDateStatusColor(v.taxDateDue)}`}>
                            {v.taxDateDue}
                          </Badge>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-600 dark:text-slate-400">Next Service:</span>
                          <Badge className={`font-semibold ${getMileageStatusColor(v.presentMileage, v.milesNextService)}`}>
                            {v.milesNextService.toLocaleString()}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Last Service:</span>
                          <span className="font-semibold">{v.milesLastService.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-600 dark:text-slate-400">Cambelt Due:</span>
                          <Badge className={`font-semibold ${getMileageStatusColor(v.presentMileage, v.milesDueCambelt)}`}>
                            {v.milesDueCambelt.toLocaleString()}
                          </Badge>
                        </div>
                      </div>
                      <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                        <div><span className="font-medium">Defects 1wk:</span> {v.defects1}</div>
                        <div><span className="font-medium">Defects 2wk:</span> {v.defects2}</div>
                        <div><span className="font-medium">Defects 3wk:</span> {v.defects3}</div>
                        <div><span className="font-medium">Defects 4wk:</span> {v.defects4}</div>
                        <div className="flex justify-between items-center">
                          <span className="font-medium">Fire Ext.:</span>
                          <Badge className={`text-xs ${getItemStatusColor(v.fireExtinguisher)}`}>
                            {v.fireExtinguisher}
                          </Badge>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="font-medium">First Aid:</span>
                          <Badge className={`text-xs ${getItemStatusColor(v.firstAidCheck)}`}>
                            {v.firstAidCheck}
                          </Badge>
                        </div>
                        <div><span className="font-medium">Comments:</span> {v.comments}</div>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Button size="sm" disabled className="bg-blue-600 hover:bg-blue-700 opacity-50 cursor-not-allowed flex-1">Edit</Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="mt-6 flex gap-4">
                <Button disabled className="bg-blue-600 hover:bg-blue-700 opacity-50 cursor-not-allowed">Add Vehicle</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="form" className="space-y-4">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-slate-900 dark:text-white">Grouped Form Layout</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-400">
                    Sectioned for detail entry or review, suitable for eventual data input.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {vehicles.map((v) => (
                  <div key={v.reg} className="border border-slate-200 dark:border-slate-700 rounded-lg p-6 bg-slate-50 dark:bg-slate-800/50">
                    <div className="grid gap-6 md:grid-cols-3">
                      <div className="space-y-3">
                        <h3 className="font-semibold text-slate-900 dark:text-white text-lg mb-3 pb-2 border-b border-slate-200 dark:border-slate-700">Vehicle Info</h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Year:</span>
                            <span className="font-medium text-slate-900 dark:text-white">{v.year}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Reg:</span>
                            <span className="font-medium text-slate-900 dark:text-white">{v.reg}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Brand:</span>
                            <span className="font-medium text-slate-900 dark:text-white">{v.brand}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Model:</span>
                            <span className="font-medium text-slate-900 dark:text-white">{v.model}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Driver:</span>
                            <span className="font-medium text-slate-900 dark:text-white">{v.driver}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-slate-600 dark:text-slate-400">Hardware ID:</span>
                            <span className="font-medium text-slate-900 dark:text-white">{v.hardwareId}</span>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <h3 className="font-semibold text-slate-900 dark:text-white text-lg mb-3 pb-2 border-b border-slate-200 dark:border-slate-700">Scheduled & History</h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Present Mileage:</span>
                            <span className="font-medium text-slate-900 dark:text-white">{v.presentMileage.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-600 dark:text-slate-400">Next Service:</span>
                            <Badge className={`${getMileageStatusColor(v.presentMileage, v.milesNextService)}`}>
                              {v.milesNextService.toLocaleString()}
                            </Badge>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Last Service:</span>
                            <span className="font-medium text-slate-900 dark:text-white">{v.milesLastService.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-600 dark:text-slate-400">Cambelt Due:</span>
                            <Badge className={`${getMileageStatusColor(v.presentMileage, v.milesDueCambelt)}`}>
                              {v.milesDueCambelt.toLocaleString()}
                            </Badge>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Cambelt Done:</span>
                            <span className="font-medium text-slate-900 dark:text-white">{v.cambeltDone}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-600 dark:text-slate-400">MOT Due:</span>
                            <Badge className={`${getDateStatusColor(v.motDateDue)}`}>
                              {v.motDateDue}
                            </Badge>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-600 dark:text-slate-400">TAX Due:</span>
                            <Badge className={`${getDateStatusColor(v.taxDateDue)}`}>
                              {v.taxDateDue}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <h3 className="font-semibold text-slate-900 dark:text-white text-lg mb-3 pb-2 border-b border-slate-200 dark:border-slate-700">Safety / Defects</h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Defects (1wk):</span>
                            <span className="font-medium text-slate-900 dark:text-white">{v.defects1}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Defects (2wk):</span>
                            <span className="font-medium text-slate-900 dark:text-white">{v.defects2}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Defects (3wk):</span>
                            <span className="font-medium text-slate-900 dark:text-white">{v.defects3}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Defects (4wk):</span>
                            <span className="font-medium text-slate-900 dark:text-white">{v.defects4}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-600 dark:text-slate-400">Fire Extinguisher:</span>
                            <Badge className={`${getItemStatusColor(v.fireExtinguisher)}`}>
                              {v.fireExtinguisher}
                            </Badge>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-600 dark:text-slate-400">First Aid:</span>
                            <Badge className={`${getItemStatusColor(v.firstAidCheck)}`}>
                              {v.firstAidCheck}
                            </Badge>
                          </div>
                          <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                            <span className="text-slate-600 dark:text-slate-400 block mb-1">Comments:</span>
                            <span className="font-medium text-slate-900 dark:text-white text-xs">{v.comments}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                      <Button disabled size="sm" className="bg-blue-600 hover:bg-blue-700 opacity-50 cursor-not-allowed">Edit Vehicle</Button>
                      <Button disabled size="sm" variant="outline" className="opacity-50 cursor-not-allowed">View History</Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex gap-4">
                <Button disabled className="bg-blue-600 hover:bg-blue-700 opacity-50 cursor-not-allowed">Add Vehicle</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Footer Note */}
      <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
        <CardContent className="pt-6">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            <strong>Demo Note:</strong> This page is visible to managers/admins only. All data is placeholder/mock and will eventually link to real inspections and service records. Choose your preferred layout style above and provide feedback!
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
