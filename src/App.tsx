import React, { useState, useMemo, useEffect, Component } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { 
  Upload, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRightLeft, 
  Filter, 
  Download, 
  Search,
  ChevronDown,
  ChevronUp,
  Building2,
  MapPin,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Table as TableIcon,
  Info,
  LogOut,
  LogIn,
  User as UserIcon,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  auth, 
  db, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot, 
  collection, 
  getDocs,
  query,
  where,
  writeBatch,
  googleProvider 
} from './firebase';
import { 
  normalizeCNPJ, 
  formatCNPJ, 
  alignPeriods, 
  findBestMatch,
  ClientData, 
  FAIXAS, 
  CANAIS 
} from './utils';
import { SALES_SCHEMA, SchemaKey } from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

async function generateHash(obj: any) {
  const str = JSON.stringify(obj);
  const msgUint8 = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- Components ---

const Button = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  className,
  disabled,
  title
}: { 
  children: React.ReactNode; 
  onClick?: () => void; 
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  className?: string;
  disabled?: boolean;
  title?: string;
}) => {
  const variants = {
    primary: "bg-black text-white hover:bg-black/90",
    secondary: "bg-emerald-600 text-white hover:bg-emerald-700",
    outline: "border border-black/10 hover:bg-black/5",
    ghost: "hover:bg-black/5"
  };

  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "px-4 py-2 rounded-xl font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2",
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  );
};

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden", className)}>
    {children}
  </div>
);

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends (React.Component as any) {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-red-50">
          <Card className="p-8 max-w-md w-full border-red-100">
            <div className="flex flex-col items-center text-center gap-4">
              <AlertCircle className="w-12 h-12 text-red-500" />
              <h2 className="text-xl font-bold text-red-900">Algo deu errado</h2>
              <p className="text-sm text-red-600">
                Ocorreu um erro inesperado. Tente recarregar a página.
              </p>
              <pre className="text-[10px] bg-black/5 p-4 rounded-lg w-full overflow-auto text-left max-h-40">
                {JSON.stringify(this.state.error, null, 2)}
              </pre>
              <Button onClick={() => window.location.reload()} variant="primary">
                Recarregar Página
              </Button>
            </div>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Main App ---

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

const COLLECTION_MAP: Record<SchemaKey, string> = {
  CABRAL: 'cabral_sales',
  MASTTER: 'mastter_sales',
  CLIENTES_MASTTER: 'clients_mastter',
  ROTEIRO: 'roteiro'
};

function AppContent() {
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [files, setFiles] = useState<Record<SchemaKey, any[] | null>>({
    CABRAL: null,
    MASTTER: null,
    CLIENTES_MASTTER: null,
    ROTEIRO: null
  });

  const [mapping, setMapping] = useState<Record<SchemaKey, Record<string, string>>>({
    CABRAL: {},
    MASTTER: {},
    CLIENTES_MASTTER: {},
    ROTEIRO: {}
  });

  const [step, setStep] = useState<'upload' | 'mapping' | 'dashboard'>('upload');
  const [showFilters, setShowFilters] = useState(true);
  const [currentMappingKey, setCurrentMappingKey] = useState<SchemaKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [receitaCache, setReceitaCache] = useState<Record<string, any>>({});
  const [reclassifiedChannels, setReclassifiedChannels] = useState<Record<string, string>>({});

  // Filters
  const [filterFaixa, setFilterFaixa] = useState<string>('ALL');
  const [filterCanal, setFilterCanal] = useState<string>('ALL');
  const [filterRepresentante, setFilterRepresentante] = useState<string>('ALL');
  const [filterSupervisor, setFilterSupervisor] = useState<string>('ALL');
  const [filterCategoria, setFilterCategoria] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Auth & Persistence
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(doc(db, 'settings', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.mapping) setMapping(data.mapping);
        if (data.reclassifiedChannels) setReclassifiedChannels(data.reclassifiedChannels);
      }
    });

    return () => unsubscribe();
  }, [user]);

  // Load Imported Data from Firestore
  useEffect(() => {
    if (!user) {
      setFiles({
        CABRAL: null,
        MASTTER: null,
        CLIENTES_MASTTER: null,
        ROTEIRO: null
      });
      return;
    }

    const loadData = async () => {
      setLoading(true);
      const newFiles: Record<SchemaKey, any[] | null> = { ...files };
      
      for (const key of Object.keys(COLLECTION_MAP) as SchemaKey[]) {
        try {
          const q = query(collection(db, 'users', user.uid, COLLECTION_MAP[key]));
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            newFiles[key] = snapshot.docs.map(doc => doc.data().data);
          }
        } catch (error) {
          console.error(`Erro ao carregar ${key}:`, error);
        }
      }
      
      setFiles(newFiles);
      setLoading(false);
    };

    loadData();
  }, [user]);

  const saveSettingsToFirebase = async (newMapping?: any, newReclassified?: any) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'settings', user.uid), {
        mapping: newMapping || mapping,
        reclassifiedChannels: newReclassified || reclassifiedChannels,
        updatedAt: new Date()
      }, { merge: true });
    } catch (error) {
      console.error("Erro ao salvar configurações:", error);
    }
  };

  const saveImportedData = async (key: SchemaKey, data: any[]) => {
    if (!user) return;
    setSyncing(true);
    setSyncProgress(0);
    
    const collectionName = COLLECTION_MAP[key];
    const total = data.length;
    const batchSize = 400; // Safe batch limit
    
    try {
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = data.slice(i, i + batchSize);
        
        for (const row of chunk) {
          const hash = await generateHash(row);
          let docId = hash;
          
          // For registries, use CNPJ as ID to allow updates
          if (key === 'CLIENTES_MASTTER' || key === 'ROTEIRO') {
            const m = mapping[key];
            const cnpj = normalizeCNPJ(row[m.cnpj]);
            if (cnpj) docId = cnpj;
          }
          
          const docRef = doc(db, 'users', user.uid, collectionName, docId);
          batch.set(docRef, {
            data: row,
            importedAt: new Date(),
            hash
          }, { merge: true });
        }
        
        await batch.commit();
        setSyncProgress(Math.min(Math.round(((i + batchSize) / total) * 100), 100));
      }
    } catch (error) {
      console.error(`Erro ao salvar dados de ${key}:`, error);
    } finally {
      setSyncing(false);
      setSyncProgress(0);
    }
  };

  const handleFileUpload = (key: SchemaKey, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = event.target?.result;
      let jsonData: any[] = [];

      if (file.name.endsWith('.csv')) {
        Papa.parse(data as string, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            jsonData = results.data;
            processAutoMapping(key, jsonData);
          }
        });
      } else {
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        jsonData = XLSX.utils.sheet_to_json(worksheet);
        processAutoMapping(key, jsonData);
      }
    };

    if (file.name.endsWith('.csv')) {
      reader.readAsText(file);
    } else {
      reader.readAsBinaryString(file);
    }
  };

  const processAutoMapping = (key: SchemaKey, data: any[]) => {
    setFiles(prev => ({ ...prev, [key]: data }));
    
    if (data.length > 0) {
      const columns = Object.keys(data[0]);
      const schema = SALES_SCHEMA[key];
      const newMap: Record<string, string> = { ...mapping[key] };
      
      schema.forEach(field => {
        const match = findBestMatch(field.key, columns);
        if (match) newMap[field.key] = match;
      });
      
      const newMapping = { ...mapping, [key]: newMap };
      setMapping(newMapping);
      saveSettingsToFirebase(newMapping);
      
      // Save data to Firestore
      saveImportedData(key, data);
    }
  };

  const startMapping = (key: SchemaKey) => {
    setCurrentMappingKey(key);
    setStep('mapping');
  };

  const saveMapping = (key: SchemaKey, currentMap: Record<string, string>) => {
    const newMapping = { ...mapping, [key]: currentMap };
    setMapping(newMapping);
    saveSettingsToFirebase(newMapping);
    setCurrentMappingKey(null);
    setStep('upload');
  };

  const clearData = async (key: SchemaKey) => {
    if (!user || !window.confirm(`Tem certeza que deseja apagar todos os dados de ${key} do banco de dados?`)) return;
    
    setLoading(true);
    const collectionName = COLLECTION_MAP[key];
    
    try {
      const q = query(collection(db, 'users', user.uid, collectionName));
      const snapshot = await getDocs(q);
      
      const batchSize = 400;
      const docs = snapshot.docs;
      
      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + batchSize);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      
      setFiles(prev => ({ ...prev, [key]: null }));
    } catch (error) {
      console.error(`Erro ao limpar ${key}:`, error);
    } finally {
      setLoading(false);
    }
  };

  const fetchReceita = async (cnpj: string) => {
    if (receitaCache[cnpj]) return receitaCache[cnpj];
    
    // Check Firestore Cache first
    try {
      const cacheDoc = await getDoc(doc(db, 'receita_cache', cnpj));
      if (cacheDoc.exists()) {
        const cachedData = cacheDoc.data().data;
        setReceitaCache(prev => ({ ...prev, [cnpj]: cachedData }));
        return cachedData;
      }
    } catch (error) {
      console.error("Erro ao ler cache do Firestore:", error);
    }
    
    try {
      const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
      if (response.ok) {
        const data = await response.json();
        const result = {
          razaoSocial: data.razao_social,
          cidade: data.municipio,
          cnae: data.cnae_fiscal_descricao
        };
        
        // Save to Local Cache
        setReceitaCache(prev => ({ ...prev, [cnpj]: result }));
        
        // Save to Firestore Cache
        if (user) {
          setDoc(doc(db, 'receita_cache', cnpj), {
            data: result,
            updatedAt: new Date()
          }).catch(err => console.error("Erro ao salvar cache no Firestore:", err));
        }
        
        return result;
      }
    } catch (error) {
      console.error("Erro ao buscar Receita:", error);
    }
    return null;
  };

  const bulkSyncReceita = async () => {
    setSyncing(true);
    setSyncProgress(0);
    const cnpjs = consolidatedData.map(c => c.cnpj);
    const total = cnpjs.length;
    
    // We process in small batches to avoid rate limiting
    const batchSize = 3;
    for (let i = 0; i < cnpjs.length; i += batchSize) {
      const batch = cnpjs.slice(i, i + batchSize);
      await Promise.all(batch.map(cnpj => fetchReceita(cnpj)));
      
      const currentProgress = Math.min(Math.round(((i + batchSize) / total) * 100), 100);
      setSyncProgress(currentProgress);

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    setSyncing(false);
    setSyncProgress(0);
  };

  const consolidatedData = useMemo(() => {
    if (!files.CABRAL || !files.MASTTER) return [];

    const clients: Record<string, ClientData> = {};
    const registryMap: Record<string, any> = {};

    // Build registry map from extra files
    if (files.CLIENTES_MASTTER) {
      const m = mapping.CLIENTES_MASTTER;
      files.CLIENTES_MASTTER.forEach(row => {
        const cnpj = normalizeCNPJ(row[m.cnpj]);
        if (cnpj) registryMap[cnpj] = { ...registryMap[cnpj], ...row, source: 'CLIENTES' };
      });
    }

    if (files.ROTEIRO) {
      const m = mapping.ROTEIRO;
      files.ROTEIRO.forEach(row => {
        const cnpj = normalizeCNPJ(row[m.cnpj]);
        if (cnpj) registryMap[cnpj] = { ...registryMap[cnpj], ...row, source: 'ROTEIRO' };
      });
    }

    // Process Cabral
    files.CABRAL.forEach(row => {
      const m = mapping.CABRAL;
      const cnpj = normalizeCNPJ(row[m.cnpj]);
      const period = String(row[m.anoperiodo]);
      const value = parseFloat(String(row[m.totalVenda]).replace(',', '.')) || 0;

      if (!clients[cnpj]) {
        const reg = registryMap[cnpj] || {};
        clients[cnpj] = {
          cnpj,
          razaoSocial: String(row[m.razaoSocial] || reg[mapping.CLIENTES_MASTTER?.razaoSocial] || reg[mapping.ROTEIRO?.razaoSocial] || ''),
          cidade: String(row[m.cidade] || reg[mapping.CLIENTES_MASTTER?.cidade] || reg[mapping.ROTEIRO?.cidade] || ''),
          canal: String(row[m.canal] || '').toUpperCase(),
          canalReclassificado: reclassifiedChannels[cnpj] || String(row[m.canal] || '').toUpperCase(),
          categoria: String(row[m.categoria] || ''),
          nomeRepresentante: String(reg[mapping.ROTEIRO?.nomeRepresentante] || ''),
          nomeSupervisor: String(reg[mapping.ROTEIRO?.nomeSupervisor] || ''),
          vendasCabral: {},
          vendasMastter: {},
          totalCabral: 0,
          totalMastter: 0,
          mediaCabral: 0,
          mediaMastter: 0
        };
      }
      clients[cnpj].vendasCabral[period] = (clients[cnpj].vendasCabral[period] || 0) + value;
      clients[cnpj].totalCabral += value;
    });

    // Process Mastter
    files.MASTTER.forEach(row => {
      const m = mapping.MASTTER;
      const cnpj = normalizeCNPJ(row[m.cnpj]);
      const period = String(row[m.anoperiodo]);
      const value = parseFloat(String(row[m.valorVenda]).replace(',', '.')) || 0;

      if (!clients[cnpj]) {
        const reg = registryMap[cnpj] || {};
        clients[cnpj] = {
          cnpj,
          razaoSocial: String(row[m.razaoSocial] || reg[mapping.CLIENTES_MASTTER?.razaoSocial] || reg[mapping.ROTEIRO?.razaoSocial] || ''),
          cidade: String(reg[mapping.CLIENTES_MASTTER?.cidade] || reg[mapping.ROTEIRO?.cidade] || ''),
          canal: String(row[m.canal] || '').toUpperCase(),
          canalReclassificado: reclassifiedChannels[cnpj] || String(row[m.canal] || '').toUpperCase(),
          categoria: String(row[m.categoria] || ''),
          nomeRepresentante: String(reg[mapping.ROTEIRO?.nomeRepresentante] || ''),
          nomeSupervisor: String(reg[mapping.ROTEIRO?.nomeSupervisor] || ''),
          vendasCabral: {},
          vendasMastter: {},
          totalCabral: 0,
          totalMastter: 0,
          mediaCabral: 0,
          mediaMastter: 0
        };
      }
      clients[cnpj].vendasMastter[period] = (clients[cnpj].vendasMastter[period] || 0) + value;
      clients[cnpj].totalMastter += value;
    });

    // Calculate Averages
    Object.values(clients).forEach(client => {
      const periodsCabral = Object.keys(client.vendasCabral).length;
      const periodsMastter = Object.keys(client.vendasMastter).length;
      client.mediaCabral = periodsCabral > 0 ? client.totalCabral / periodsCabral : 0;
      client.mediaMastter = periodsMastter > 0 ? client.totalMastter / periodsMastter : 0;
    });

    return Object.values(clients);
  }, [files, mapping, reclassifiedChannels]);

  const alignedPeriods = useMemo(() => {
    if (!files.CABRAL || !files.MASTTER) return [];
    const mC = mapping.CABRAL;
    const mM = mapping.MASTTER;
    const cabralPeriods = files.CABRAL.map(r => String(r[mC.anoperiodo]));
    const mastterPeriods = files.MASTTER.map(r => String(r[mM.anoperiodo]));
    return alignPeriods(cabralPeriods, mastterPeriods);
  }, [files, mapping]);

  const filteredData = useMemo(() => {
    return consolidatedData.filter(client => {
      // Faixa filter (based on Cabral Average)
      if (filterFaixa !== 'ALL') {
        const avg = client.mediaCabral;
        if (filterFaixa === 'FAIXA_1' && avg < 5000) return false;
        if (filterFaixa === 'FAIXA_2' && (avg < 1000 || avg >= 5000)) return false;
        if (filterFaixa === 'OUTROS' && avg >= 1000) return false;
      }

      // Canal filter
      if (filterCanal !== 'ALL' && client.canalReclassificado !== filterCanal) return false;

      // Representante filter
      if (filterRepresentante !== 'ALL' && client.nomeRepresentante !== filterRepresentante) return false;

      // Supervisor filter
      if (filterSupervisor !== 'ALL' && client.nomeSupervisor !== filterSupervisor) return false;

      // Categoria filter
      if (filterCategoria !== 'ALL' && client.categoria !== filterCategoria) return false;

      // Search
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        return (
          client.razaoSocial.toLowerCase().includes(search) ||
          client.cnpj.includes(search) ||
          client.nomeRepresentante.toLowerCase().includes(search)
        );
      }

      return true;
    });
  }, [consolidatedData, filterFaixa, filterCanal, filterRepresentante, filterSupervisor, filterCategoria, searchTerm]);

  const availableChannels = useMemo(() => {
    const channels = new Set(consolidatedData.map(c => c.canalReclassificado));
    return Array.from(channels).sort();
  }, [consolidatedData]);

  const availableRepresentantes = useMemo(() => {
    const reps = new Set(consolidatedData.map(c => c.nomeRepresentante).filter(Boolean));
    return Array.from(reps).sort();
  }, [consolidatedData]);

  const availableSupervisores = useMemo(() => {
    const sups = new Set(consolidatedData.map(c => c.nomeSupervisor).filter(Boolean));
    return Array.from(sups).sort();
  }, [consolidatedData]);

  const availableCategorias = useMemo(() => {
    const cats = new Set(consolidatedData.map(c => c.categoria).filter(Boolean));
    return Array.from(cats).sort();
  }, [consolidatedData]);

  const stats = useMemo(() => {
    const totalCabral = filteredData.reduce((acc, c) => acc + c.totalCabral, 0);
    const totalMastter = filteredData.reduce((acc, c) => acc + c.totalMastter, 0);
    const avgCabral = totalCabral / (filteredData.length || 1);
    const avgMastter = totalMastter / (filteredData.length || 1);
    const growth = totalCabral > 0 ? ((totalMastter - totalCabral) / totalCabral) * 100 : 0;

    return { totalCabral, totalMastter, avgCabral, avgMastter, growth };
  }, [filteredData]);

  const handleReclassify = (cnpj: string, newCanal: string) => {
    const newReclassified = { ...reclassifiedChannels, [cnpj]: newCanal };
    setReclassifiedChannels(newReclassified);
    saveSettingsToFirebase(undefined, newReclassified);
  };

  if (step === 'upload') {
    return (
      <div className="min-h-screen bg-[#F5F5F4] p-6 md:p-12 font-sans text-[#141414]">
        <div className="max-w-5xl mx-auto">
          <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h1 className="text-5xl font-bold tracking-tight mb-4">Consolidador de Vendas</h1>
              <p className="text-black/60 text-lg">Compare o desempenho entre Cabral e Mastter através de períodos similares.</p>
              {loading && (
                <div className="mt-4 flex items-center gap-2 text-emerald-600 font-bold animate-pulse">
                  <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                  Carregando dados salvos na nuvem...
                </div>
              )}
              {syncing && (
                <div className="mt-4 p-4 bg-white rounded-2xl border border-black/5 shadow-sm">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold uppercase tracking-widest text-black/40">Sincronizando com a nuvem...</span>
                    <span className="text-xs font-bold text-emerald-600">{syncProgress}%</span>
                  </div>
                  <div className="h-2 bg-black/5 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-emerald-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${syncProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-4">
              {user ? (
                <div className="flex items-center gap-3 bg-white p-2 pr-4 rounded-full border border-black/5 shadow-sm">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt={user.displayName} className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center">
                      <UserIcon className="w-4 h-4" />
                    </div>
                  )}
                  <div className="flex flex-col">
                    <span className="text-xs font-bold leading-tight">{user.displayName}</span>
                    <button onClick={() => signOut(auth)} className="text-[10px] text-red-500 font-bold hover:underline text-left">Sair</button>
                  </div>
                </div>
              ) : (
                <Button onClick={() => signInWithPopup(auth, googleProvider)} variant="outline" className="rounded-full">
                  <LogIn className="w-4 h-4" />
                  Entrar com Google
                </Button>
              )}
            </div>
          </header>

          {!user && (
            <div className="mb-8 p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-center gap-3">
              <Info className="w-5 h-5 text-amber-500" />
              <p className="text-sm text-amber-700">
                <strong>Dica:</strong> Faça login para salvar seus mapeamentos e reclassificações automaticamente.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(Object.keys(SALES_SCHEMA) as SchemaKey[]).map((key) => (
              <div key={key}>
                <Card className="p-6 flex flex-col gap-4 h-full">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-black/5 flex items-center justify-center">
                        <FileSpreadsheet className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg">{key.replace('_', ' ')}</h3>
                        <p className="text-xs text-black/40 uppercase tracking-widest font-semibold">
                          {files[key] ? `${files[key]?.length} registros` : 'Aguardando arquivo'}
                        </p>
                      </div>
                    </div>
                    {files[key] && (
                      <CheckCircle2 className="text-emerald-500 w-6 h-6" />
                    )}
                  </div>

                  <div className="mt-2">
                    <label className="block">
                      <span className="sr-only">Escolher arquivo</span>
                      <input 
                        type="file" 
                        accept=".xlsx, .xls, .csv"
                        onChange={(e) => handleFileUpload(key, e)}
                        className="block w-full text-sm text-slate-500
                          file:mr-4 file:py-2 file:px-4
                          file:rounded-full file:border-0
                          file:text-sm file:font-semibold
                          file:bg-black file:text-white
                          hover:file:bg-black/80 cursor-pointer"
                      />
                    </label>
                  </div>

                  {files[key] && (
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <Button 
                          variant={Object.keys(mapping[key]).length > 0 ? 'outline' : 'primary'}
                          onClick={() => startMapping(key)}
                          className="flex-1"
                        >
                          {Object.keys(mapping[key]).length > 0 ? 'Revisar Mapeamento' : 'Mapear Colunas'}
                        </Button>
                        <Button 
                          variant="ghost" 
                          onClick={() => clearData(key)}
                          className="text-red-500 hover:bg-red-50 px-3"
                          title="Limpar dados do banco"
                        >
                          Limpar
                        </Button>
                      </div>
                      {Object.keys(mapping[key]).length > 0 && (
                        <p className="text-[10px] text-emerald-600 font-bold flex items-center gap-1 justify-center">
                          <CheckCircle2 className="w-3 h-3" />
                          Dados sincronizados na nuvem
                        </p>
                      )}
                    </div>
                  )}
                </Card>
              </div>
            ))}
          </div>

          <div className="mt-12 flex justify-center">
            <Button 
              variant="secondary" 
              className="px-12 py-4 text-lg rounded-2xl shadow-lg shadow-emerald-600/20"
              disabled={!files.CABRAL || !files.MASTTER || Object.keys(mapping.CABRAL).length === 0 || Object.keys(mapping.MASTTER).length === 0}
              onClick={() => setStep('dashboard')}
            >
              Gerar Dashboard de Comparação
              <ArrowRightLeft className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'mapping' && currentMappingKey) {
    const schema = SALES_SCHEMA[currentMappingKey];
    const firstRow = files[currentMappingKey]?.[0] || {};
    const columns = Object.keys(firstRow);
    const currentMap = { ...mapping[currentMappingKey] };

    return (
      <div className="min-h-screen bg-[#F5F5F4] p-6 md:p-12 font-sans">
        <div className="max-w-3xl mx-auto">
          <Card className="p-8">
            <h2 className="text-3xl font-bold mb-2">Mapeamento de Colunas</h2>
            <p className="text-black/50 mb-8">Relacione as colunas da sua planilha com os campos do sistema para {currentMappingKey}.</p>
            
            <div className="space-y-6">
              {schema.map((field) => (
                <div key={field.key} className="flex flex-col gap-2">
                  <label className="font-semibold flex items-center gap-2">
                    {field.label}
                    {field.required && <span className="text-red-500">*</span>}
                  </label>
                  <select 
                    className="w-full p-3 rounded-xl border border-black/10 bg-black/5 focus:outline-none focus:ring-2 focus:ring-black/5"
                    value={currentMap[field.key] || ''}
                    onChange={(e) => {
                      currentMap[field.key] = e.target.value;
                      setMapping(prev => ({
                        ...prev,
                        [currentMappingKey]: { ...currentMap }
                      }));
                    }}
                  >
                    <option value="">Selecione a coluna...</option>
                    {columns.map(col => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="mt-12 flex gap-4">
              <Button variant="outline" onClick={() => setStep('upload')} className="flex-1">Cancelar</Button>
              <Button onClick={() => saveMapping(currentMappingKey, currentMap)} className="flex-1">Salvar Mapeamento</Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#141414] font-sans">
      {/* Sidebar/Filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowFilters(false)}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-20 xl:hidden"
          />
        )}
      </AnimatePresence>

      <div className={cn(
        "fixed top-0 left-0 h-full bg-white border-r border-black/5 flex flex-col z-30 transition-all duration-300 ease-in-out shadow-xl xl:shadow-none",
        showFilters ? "w-80 translate-x-0" : "w-0 -translate-x-full border-none"
      )}>
        <div className={cn(
          "flex flex-col h-full transition-opacity duration-200", 
          showFilters ? "opacity-100 p-8" : "opacity-0 pointer-events-none p-0"
        )}>
          <div className="flex items-center justify-between mb-6 shrink-0">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Filter className="w-5 h-5" />
              Filtros
            </h2>
            <button 
              onClick={() => setShowFilters(false)}
              className="p-2 hover:bg-black/5 rounded-lg transition-colors"
              title="Ocultar Filtros"
            >
              <PanelLeftClose className="w-5 h-5 text-black/40" />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-6 pb-8">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-black/40">Busca</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" />
                <input 
                  type="text" 
                  placeholder="Razão Social ou CNPJ..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-black/5 border-none focus:ring-2 focus:ring-black/10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-black/40">Faixa de Média (Cabral)</label>
              <div className="flex flex-col gap-2">
                {['ALL', 'FAIXA_1', 'FAIXA_2', 'OUTROS'].map(f => (
                  <button 
                    key={f}
                    onClick={() => setFilterFaixa(f)}
                    className={cn(
                      "text-left px-4 py-2 rounded-lg transition-all text-sm font-medium",
                      filterFaixa === f ? "bg-black text-white" : "hover:bg-black/5 text-black/60"
                    )}
                  >
                    {f === 'ALL' ? 'Todos' : FAIXAS[f as keyof typeof FAIXAS].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-black/40">Canal</label>
              <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                {['ALL', ...availableChannels].map(c => (
                  <button 
                    key={c}
                    onClick={() => setFilterCanal(c)}
                    className={cn(
                      "text-left px-4 py-2 rounded-lg transition-all text-sm font-medium flex items-center justify-between",
                      filterCanal === c ? "bg-black text-white" : "hover:bg-black/5 text-black/60",
                      c === 'OUTROS' && "border border-orange-200"
                    )}
                  >
                    <span>{c === 'ALL' ? 'Todos' : c}</span>
                    {c === 'OUTROS' && <AlertCircle className="w-3 h-3 text-orange-500" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-black/40">Representante</label>
              <select 
                className="w-full p-3 rounded-xl border border-black/5 bg-black/5 focus:outline-none focus:ring-2 focus:ring-black/5 text-sm font-medium"
                value={filterRepresentante}
                onChange={(e) => setFilterRepresentante(e.target.value)}
              >
                <option value="ALL">Todos os Representantes</option>
                {availableRepresentantes.map(rep => (
                  <option key={rep} value={rep}>{rep}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-black/40">Supervisor</label>
              <select 
                className="w-full p-3 rounded-xl border border-black/5 bg-black/5 focus:outline-none focus:ring-2 focus:ring-black/5 text-sm font-medium"
                value={filterSupervisor}
                onChange={(e) => setFilterSupervisor(e.target.value)}
              >
                <option value="ALL">Todos os Supervisores</option>
                {availableSupervisores.map(sup => (
                  <option key={sup} value={sup}>{sup}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-black/40">Categoria</label>
              <select 
                className="w-full p-3 rounded-xl border border-black/5 bg-black/5 focus:outline-none focus:ring-2 focus:ring-black/5 text-sm font-medium"
                value={filterCategoria}
                onChange={(e) => setFilterCategoria(e.target.value)}
              >
                <option value="ALL">Todas as Categorias</option>
                {availableCategorias.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-auto pt-6 border-t border-black/5 shrink-0">
            <Button variant="outline" className="w-full" onClick={() => setStep('upload')}>
              Voltar ao Início
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className={cn(
        "p-6 md:p-12 transition-all duration-300 ease-in-out",
        showFilters ? "xl:ml-80" : "xl:ml-0"
      )}>
        <div className="max-w-7xl mx-auto">
          <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
            <div className="flex items-start gap-4">
              {!showFilters && (
                <button 
                  onClick={() => setShowFilters(true)}
                  className="p-3 bg-white border border-black/5 rounded-xl shadow-sm hover:bg-black/5 transition-all active:scale-95 flex"
                  title="Exibir Filtros"
                >
                  <PanelLeftOpen className="w-6 h-6 text-black/60" />
                </button>
              )}
              <div>
                <div className="flex items-center gap-2 text-emerald-600 font-bold text-sm uppercase tracking-widest mb-2">
                  <BarChart3 className="w-4 h-4" />
                  Análise de Desempenho
                </div>
                <h1 className="text-4xl font-bold tracking-tight">Dashboard Consolidado</h1>
              </div>
            </div>
            <div className="flex gap-3">
              {consolidatedData.some(c => c.canalReclassificado === 'OUTROS') && (
                <div className="flex items-center gap-2 px-4 py-2 bg-orange-50 border border-orange-100 rounded-xl text-orange-700 text-xs font-bold animate-pulse">
                  <AlertCircle className="w-4 h-4" />
                  Existem clientes no canal "OUTROS" para tratar
                </div>
              )}
              <Button 
                variant="secondary" 
                onClick={bulkSyncReceita} 
                disabled={syncing}
                className="relative min-w-[220px]"
              >
                {syncing ? (
                  <>
                    Sincronizando... {syncProgress}%
                    <motion.div 
                      className="absolute bottom-0 left-0 h-1 bg-emerald-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${syncProgress}%` }}
                    />
                  </>
                ) : (
                  <>
                    <ArrowRightLeft className="w-4 h-4" />
                    Sincronizar Receita (Todos)
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={() => {
                const data = filteredData.map(c => {
                  const row: any = {
                    CNPJ: c.cnpj,
                    'Razão Social': c.razaoSocial,
                    'Razão Social (Receita)': receitaCache[c.cnpj]?.razaoSocial || '',
                    'Atividade/CNAE (Receita)': receitaCache[c.cnpj]?.cnae || '',
                    Cidade: c.cidade,
                    'Cidade (Receita)': receitaCache[c.cnpj]?.cidade || '',
                    Canal: c.canal,
                    'Canal Reclassificado': c.canalReclassificado,
                    Representante: c.nomeRepresentante,
                    Supervisor: c.nomeSupervisor,
                    'Total Cabral': c.totalCabral,
                    'Média Cabral': c.mediaCabral,
                    'Total Mastter': c.totalMastter,
                    'Média Mastter': c.mediaMastter,
                    'Crescimento %': c.totalCabral > 0 ? (((c.totalMastter - c.totalCabral) / c.totalCabral) * 100).toFixed(2) : '0'
                  };
                  
                  // Add individual periods
                  alignedPeriods.forEach((p, idx) => {
                    row[`Cabral ${p.cabral}`] = c.vendasCabral[p.cabral] || 0;
                    row[`Mastter ${p.mastter}`] = c.vendasMastter[p.mastter] || 0;
                  });
                  
                  return row;
                });
                const ws = XLSX.utils.json_to_sheet(data);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Consolidado Completo");
                XLSX.writeFile(wb, "comparativo_vendas_completo.xlsx");
              }}>
                <Download className="w-4 h-4" />
                Exportar Completo
              </Button>
            </div>
          </header>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            <Card className="p-6 border-l-4 border-l-black bg-white">
              <div className="flex justify-between items-start mb-4">
                <p className="text-xs font-bold text-black/40 uppercase tracking-widest">Total Cabral</p>
                <div className="p-2 bg-black/5 rounded-lg">
                  <BarChart3 className="w-4 h-4 text-black/40" />
                </div>
              </div>
              <h3 className="text-3xl font-bold tracking-tight">
                {stats.totalCabral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </h3>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] font-bold text-black/40 uppercase">Média:</span>
                <span className="text-xs font-bold text-black/60">{stats.avgCabral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
              </div>
            </Card>

            <Card className="p-6 border-l-4 border-l-emerald-500 bg-white shadow-emerald-500/5">
              <div className="flex justify-between items-start mb-4">
                <p className="text-xs font-bold text-black/40 uppercase tracking-widest">Total Mastter</p>
                <div className="p-2 bg-emerald-50 rounded-lg">
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                </div>
              </div>
              <h3 className="text-3xl font-bold tracking-tight text-emerald-700">
                {stats.totalMastter.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </h3>
              <div className={cn(
                "flex items-center gap-1 text-sm font-bold mt-2 px-2 py-0.5 rounded-full w-fit",
                stats.growth >= 0 ? "text-emerald-700 bg-emerald-100" : "text-red-700 bg-red-100"
              )}>
                {stats.growth >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {Math.abs(stats.growth).toFixed(1)}% vs Cabral
              </div>
            </Card>

            <Card className="p-6 border-l-4 border-l-indigo-500 bg-white">
              <div className="flex justify-between items-start mb-4">
                <p className="text-xs font-bold text-black/40 uppercase tracking-widest">Ticket Médio (C)</p>
                <div className="p-2 bg-indigo-50 rounded-lg">
                  <UserIcon className="w-4 h-4 text-indigo-600" />
                </div>
              </div>
              <h3 className="text-3xl font-bold tracking-tight">
                {stats.avgCabral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </h3>
              <p className="text-xs font-bold text-black/40 mt-2">Por Cliente</p>
            </Card>

            <Card className="p-6 border-l-4 border-l-violet-500 bg-white">
              <div className="flex justify-between items-start mb-4">
                <p className="text-xs font-bold text-black/40 uppercase tracking-widest">Ticket Médio (M)</p>
                <div className="p-2 bg-violet-50 rounded-lg">
                  <TrendingUp className="w-4 h-4 text-violet-600" />
                </div>
              </div>
              <h3 className="text-3xl font-bold tracking-tight">
                {stats.avgMastter.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </h3>
              <p className="text-xs font-bold text-black/40 mt-2">Por Cliente</p>
            </Card>
          </div>

          {/* Comparison Table */}
          <Card className="mb-12">
            <div className="p-6 border-b border-black/5 flex items-center justify-between bg-black/[0.02]">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <TableIcon className="w-5 h-5" />
                Comparativo por Cliente e Período
              </h2>
              <span className="text-xs font-bold text-black/40 uppercase tracking-widest">
                {filteredData.length} Clientes Filtrados
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-black/5 text-[10px] uppercase tracking-widest font-bold text-black/60">
                    <th className="p-4 sticky left-0 bg-[#F9F9F9] z-10 border-r border-black/5">Cliente / Roteiro</th>
                    {alignedPeriods.map((p, idx) => (
                      <th key={idx} className="p-4 text-center border-r border-black/5 min-w-[200px]">
                        <div className="flex flex-col">
                          <span className="text-black/40">Período {idx + 1}</span>
                          <span className="text-black">{p.cabral} vs {p.mastter}</span>
                        </div>
                      </th>
                    ))}
                    <th className="p-4 text-right bg-black/5">Totais / Médias</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {filteredData.slice(0, 50).map((client) => (
                    <tr key={client.cnpj} className="hover:bg-black/[0.01] transition-colors group">
                      <td className="p-4 sticky left-0 bg-white group-hover:bg-[#F9F9F9] z-10 border-r border-black/5">
                        <div className="flex flex-col max-w-[280px]">
                          <span className="font-bold truncate text-sm" title={client.razaoSocial}>
                            {client.razaoSocial}
                          </span>
                          <span className="text-[10px] font-mono text-black/40">
                            {formatCNPJ(client.cnpj)} | {client.cidade}
                          </span>
                          
                          <div className="mt-2 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-bold text-black/40 uppercase">Canal:</span>
                              <select 
                                className={cn(
                                  "text-[9px] border-none rounded p-0.5 font-bold",
                                  client.canalReclassificado === 'OUTROS' ? "bg-orange-100 text-orange-800" : "bg-black/5"
                                )}
                                value={client.canalReclassificado}
                                onChange={(e) => handleReclassify(client.cnpj, e.target.value)}
                              >
                                {['ALIMENTAR', 'ESPECIALIZADOS', 'OUTROS'].map(c => <option key={c} value={c}>{c}</option>)}
                                {!['ALIMENTAR', 'ESPECIALIZADOS', 'OUTROS'].includes(client.canalReclassificado) && (
                                  <option value={client.canalReclassificado}>{client.canalReclassificado}</option>
                                )}
                              </select>
                              {client.canal !== client.canalReclassificado && (
                                <span className="text-[8px] text-orange-600 font-bold italic">(Original: {client.canal})</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-bold text-black/40 uppercase">Rep:</span>
                              <span className="text-[9px] font-bold text-black/70">{client.nomeRepresentante || 'N/A'}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 mt-2">
                            <button 
                              onClick={() => fetchReceita(client.cnpj)}
                              className="text-[9px] text-emerald-600 hover:underline font-bold"
                            >
                              Consultar Receita
                            </button>
                          </div>
                          {receitaCache[client.cnpj] && (
                            <div className="mt-2 p-2 bg-emerald-50 rounded-lg border border-emerald-100 text-[10px]">
                              <div className="flex items-center gap-1 font-bold text-emerald-800">
                                <Building2 className="w-3 h-3" />
                                {receitaCache[client.cnpj].razaoSocial}
                              </div>
                              <div className="flex items-center gap-1 text-emerald-600 mt-1">
                                <MapPin className="w-3 h-3" />
                                {receitaCache[client.cnpj].cidade}
                              </div>
                              {receitaCache[client.cnpj].cnae && (
                                <div className="mt-1 pt-1 border-t border-emerald-100 text-[9px] text-emerald-700 italic leading-tight">
                                  <strong>Atividade:</strong> {receitaCache[client.cnpj].cnae}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      {alignedPeriods.map((p, idx) => {
                        const vC = client.vendasCabral[p.cabral] || 0;
                        const vM = client.vendasMastter[p.mastter] || 0;
                        const diff = vC > 0 ? ((vM - vC) / vC) * 100 : 0;
                        
                        return (
                          <td key={idx} className="p-4 border-r border-black/5">
                            <div className="flex flex-col items-center gap-1.5">
                              <div className="flex justify-between w-full text-[11px] items-center">
                                <span className="text-[9px] font-bold text-black/30 bg-black/5 px-1 rounded">C</span>
                                <span className="font-medium text-black/60">{vC.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                              </div>
                              <div className="flex justify-between w-full text-[12px] items-center">
                                <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1 rounded">M</span>
                                <span className="font-bold text-emerald-700">{vM.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                              </div>
                              {vC > 0 && (
                                <div className={cn(
                                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full w-full text-center",
                                  diff >= 0 ? "text-emerald-700 bg-emerald-100" : "text-red-700 bg-red-100"
                                )}>
                                  {diff >= 0 ? '+' : ''}{diff.toFixed(0)}%
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td className="p-4 text-right bg-black/[0.02]">
                        <div className="flex flex-col gap-3">
                          <div>
                            <p className="text-[9px] font-bold text-black/40 uppercase">Cabral</p>
                            <p className="text-sm font-medium text-black/60">{client.totalCabral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                            <p className="text-[9px] text-black/40 italic">Média: {client.mediaCabral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                          </div>
                          <div className="pt-2 border-t border-black/5">
                            <p className="text-[9px] font-bold text-emerald-600 uppercase">Mastter</p>
                            <p className="text-base font-bold text-emerald-700">{client.totalMastter.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                            <p className="text-[9px] text-emerald-600/60 italic">Média: {client.mediaMastter.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredData.length > 50 && (
                <div className="p-4 text-center text-black/40 text-sm italic border-t border-black/5">
                  Exibindo os primeiros 50 de {filteredData.length} clientes. Use a busca ou filtros para refinar.
                </div>
              )}
            </div>
          </Card>

          {/* Analysis Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card className="p-8">
              <h3 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <TrendingUp className="w-6 h-6 text-emerald-600" />
                Insights de Desempenho
              </h3>
              <div className="space-y-4">
                <div className="p-4 bg-black/5 rounded-2xl">
                  <h4 className="font-bold text-sm mb-1">Conversão de Clientes</h4>
                  <p className="text-sm text-black/60">
                    Dos {consolidatedData.length} clientes totais, {consolidatedData.filter(c => c.totalMastter > 0).length} realizaram compras na Mastter.
                  </p>
                </div>
                <div className="p-4 bg-black/5 rounded-2xl">
                  <h4 className="font-bold text-sm mb-1">Performance por Faixa (Média)</h4>
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    {['FAIXA_1', 'FAIXA_2'].map(f => {
                      const fData = consolidatedData.filter(c => {
                        const avg = c.mediaCabral;
                        if (f === 'FAIXA_1') return avg >= 5000;
                        return avg >= 1000 && avg < 5000;
                      });
                      const fMastter = fData.reduce((acc, c) => acc + c.totalMastter, 0);
                      const fCabral = fData.reduce((acc, c) => acc + c.totalCabral, 0);
                      const fGrowth = fCabral > 0 ? ((fMastter - fCabral) / fCabral) * 100 : 0;
                      
                      return (
                        <div key={f} className="bg-white p-3 rounded-xl border border-black/5">
                          <p className="text-[10px] font-bold text-black/40 uppercase">{FAIXAS[f as keyof typeof FAIXAS].label}</p>
                          <p className={cn("text-xl font-bold tracking-tight", fGrowth >= 0 ? "text-emerald-600" : "text-red-600")}>
                            {fGrowth >= 0 ? '+' : ''}{fGrowth.toFixed(1)}%
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="p-4 bg-black/5 rounded-2xl">
                  <h4 className="font-bold text-sm mb-1">Performance por Canal</h4>
                  <div className="grid grid-cols-1 gap-3 mt-3">
                    {availableChannels.map(canal => {
                      const cData = consolidatedData.filter(c => c.canalReclassificado === canal);
                      const cMastter = cData.reduce((acc, c) => acc + c.totalMastter, 0);
                      const cCabral = cData.reduce((acc, c) => acc + c.totalCabral, 0);
                      const cGrowth = cCabral > 0 ? ((cMastter - cCabral) / cCabral) * 100 : 0;
                      const clientCount = cData.length;
                      
                      return (
                        <div key={canal} className="flex items-center justify-between p-2 hover:bg-black/5 rounded-lg transition-colors">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-black/40 uppercase">{canal}</span>
                            <span className="text-[10px] text-black/40">{clientCount} Clientes</span>
                          </div>
                          <div className="text-right">
                            <p className={cn("text-base font-bold tracking-tight", cGrowth >= 0 ? "text-emerald-600" : "text-red-600")}>
                              {cGrowth >= 0 ? '+' : ''}{cGrowth.toFixed(1)}%
                            </p>
                            <p className="text-[10px] font-bold text-black/40">
                              {cMastter.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="p-4 bg-black/5 rounded-2xl">
                  <h4 className="font-bold text-sm mb-1">Performance por Categoria</h4>
                  <div className="grid grid-cols-1 gap-3 mt-3">
                    {availableCategorias.slice(0, 8).map(cat => {
                      const cData = consolidatedData.filter(c => c.categoria === cat);
                      const cMastter = cData.reduce((acc, c) => acc + c.totalMastter, 0);
                      const cCabral = cData.reduce((acc, c) => acc + c.totalCabral, 0);
                      const cGrowth = cCabral > 0 ? ((cMastter - cCabral) / cCabral) * 100 : 0;
                      
                      return (
                        <div key={cat} className="flex items-center justify-between p-2 hover:bg-black/5 rounded-lg transition-colors">
                          <span className="text-[10px] font-bold text-black/40 uppercase truncate max-w-[150px]">{cat}</span>
                          <div className="text-right">
                            <p className={cn("text-xs font-bold", cGrowth >= 0 ? "text-emerald-600" : "text-red-600")}>
                              {cGrowth >= 0 ? '+' : ''}{cGrowth.toFixed(1)}%
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {availableCategorias.length > 8 && (
                      <p className="text-[9px] text-center text-black/30 italic">Exibindo as 8 principais categorias</p>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-8">
              <h3 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <Info className="w-6 h-6 text-black/40" />
                Informações do Sistema
              </h3>
              <div className="text-sm text-black/60 space-y-4">
                <p>
                  Este sistema consolida dados de faturamento normalizando CNPJs e alinhando períodos de venda.
                </p>
                <ul className="list-disc pl-5 space-y-2">
                  <li><strong>Normalização:</strong> CNPJs são limpos e completados com zeros à esquerda.</li>
                  <li><strong>Alinhamento:</strong> Os períodos são ordenados e pareados sequencialmente.</li>
                  <li><strong>Receita:</strong> A consulta utiliza a BrasilAPI para buscar dados oficiais do SEFAZ.</li>
                </ul>
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
