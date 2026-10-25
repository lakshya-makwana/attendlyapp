import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import {
  LayoutDashboard,
  CalendarCheck,
  Calendar,
  Users,
  UserRound,
  Building2,
  MapPin,
  Wallet,
  WalletCards,
  Grid2x2,
  IndianRupee,
  ChartNoAxesCombined,
  Pencil,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Cloud,
  CloudOff,
  Check,
  CircleAlert,
  X,
  Ellipsis,
  Trash,
  Lock,
  Phone,
  CircleMinus,
  FileText,
  Banknote,
  Info,
  Receipt,
  Share2,
  ArrowLeft,
} from 'lucide-react-native';

export type IconName =
  | 'overview'
  | 'layout-dashboard'
  | 'attendance'
  | 'calendar-check'
  | 'calendar'
  | 'workers'
  | 'users'
  | 'user-round'
  | 'sites'
  | 'building'
  | 'building-2'
  | 'work-units'
  | 'grid-2x2'
  | 'advances'
  | 'wallet-cards'
  | 'map-pin'
  | 'pin'
  | 'payroll'
  | 'wallet'
  | 'indian-rupee'
  | 'rupee'
  | 'wage-history'
  | 'chart-no-axes-combined'
  | 'history'
  | 'edit'
  | 'pencil'
  | 'add'
  | 'plus'
  | 'search'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'sync'
  | 'refresh-cw'
  | 'cloud'
  | 'offline'
  | 'cloud-off'
  | 'success'
  | 'check'
  | 'error'
  | 'alert-circle'
  | 'close'
  | 'x'
  | 'more'
  | 'ellipsis'
  | 'trash'
  | 'lock'
  | 'phone'
  | 'circle-minus'
  | 'minus-circle'
  | 'file-text'
  | 'banknote'
  | 'info'
  | 'receipt'
  | 'share'
  | 'arrow-left'
  | 'back';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = 20,
  color = '#09090b',
  strokeWidth = 2,
  style,
}) => {
  const iconProps = {
    size,
    color,
    strokeWidth,
    style,
  };

  switch (name) {
    case 'overview':
    case 'layout-dashboard':
      return <LayoutDashboard {...iconProps} />;
    case 'attendance':
    case 'calendar-check':
      return <CalendarCheck {...iconProps} />;
    case 'calendar':
      return <Calendar {...iconProps} />;
    case 'workers':
    case 'users':
      return <Users {...iconProps} />;
    case 'user-round':
      return <UserRound {...iconProps} />;
    case 'sites':
    case 'building':
    case 'building-2':
      return <Building2 {...iconProps} />;
    case 'work-units':
    case 'grid-2x2':
      return <Grid2x2 {...iconProps} />;
    case 'advances':
    case 'wallet-cards':
      return <WalletCards {...iconProps} />;
    case 'map-pin':
    case 'pin':
      return <MapPin {...iconProps} />;
    case 'payroll':
    case 'wallet':
      return <Wallet {...iconProps} />;
    case 'indian-rupee':
    case 'rupee':
      return <IndianRupee {...iconProps} />;
    case 'wage-history':
    case 'chart-no-axes-combined':
    case 'history':
      return <ChartNoAxesCombined {...iconProps} />;
    case 'edit':
    case 'pencil':
      return <Pencil {...iconProps} />;
    case 'add':
    case 'plus':
      return <Plus {...iconProps} />;
    case 'search':
      return <Search {...iconProps} />;
    case 'chevron-left':
      return <ChevronLeft {...iconProps} />;
    case 'chevron-right':
      return <ChevronRight {...iconProps} />;
    case 'chevron-down':
      return <ChevronDown {...iconProps} />;
    case 'sync':
    case 'refresh-cw':
      return <RefreshCw {...iconProps} />;
    case 'cloud':
      return <Cloud {...iconProps} />;
    case 'offline':
    case 'cloud-off':
      return <CloudOff {...iconProps} />;
    case 'success':
    case 'check':
      return <Check {...iconProps} />;
    case 'error':
    case 'alert-circle':
      return <CircleAlert {...iconProps} />;
    case 'close':
    case 'x':
      return <X {...iconProps} />;
    case 'more':
    case 'ellipsis':
      return <Ellipsis {...iconProps} />;
    case 'trash':
      return <Trash {...iconProps} />;
    case 'lock':
      return <Lock {...iconProps} />;
    case 'phone':
      return <Phone {...iconProps} />;
    case 'circle-minus':
    case 'minus-circle':
      return <CircleMinus {...iconProps} />;
    case 'file-text':
      return <FileText {...iconProps} />;
    case 'banknote':
      return <Banknote {...iconProps} />;
    case 'info':
      return <Info {...iconProps} />;
    case 'receipt':
      return <Receipt {...iconProps} />;
    case 'share':
      return <Share2 {...iconProps} />;
    case 'arrow-left':
    case 'back':
      return <ArrowLeft {...iconProps} />;
    default:
      return <LayoutDashboard {...iconProps} />;
  }
};
