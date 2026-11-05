'use client';
import { useState } from 'react';
import { Box, Button, useColorMode } from '@chakra-ui/react';
import ClientDetailsForm, { type ClientDetailsValues, resetClientDetails } from 'components/onrevolt/ClientDetailsForm';

const initial: ClientDetailsValues = {
  displayName:'Jan Kowalski',clientType:'B2C',phone:'+48 602 546 002',email:'jankowalski@email.com',
  taxId:'',addressLine:'Osiedle Jagiellońskie 87/5',postalCode:'61-218',city:'Poznań',
  ownerId:'staff-1',clientProblem:'Opis',expectedResult:'Opis',
  investmentAddress:'Osiedle Jagiellońskie 87/5, Poznań',latitude:'',longitude:'',mapProvider:'GOOGLE',
  projectTitle:'Projekt - Jan Kowalski',projectClientType:'B2C',status:'LEAD',stageId:'stage-1',
  nextActionTitle:'Wizja lokalna',nextActionAt:'2026-11-05T10:00',
};
export default function ClientDetailsPreview() {
  const [values,setValues]=useState(initial);
  const [saved,setSaved]=useState(initial);
  const [message,setMessage]=useState('');
  const {toggleColorMode}=useColorMode();
  return <Box p={{base:'12px',md:'24px'}} minH="100vh" bg="var(--chakra-colors-chakra-body-bg)">
    <Box display="flex" gap="16px" mb="16px"><Button onClick={toggleColorMode}>Zmień motyw</Button><span role="status">{message}</span></Box>
    <ClientDetailsForm values={values} registeredAt="2026-02-01T10:00:00Z" origin="Polecenie" statusLabel="Nowy klient" saving={false}
      clientTypes={[["UNKNOWN","Nie określono"],["B2C","B2C"],["B2B","B2B"],["B2C_B2B","B2C/B2B"]]}
      staff={[{id:'staff-1',name:'Mariusz Śmietana'}]} stages={[{id:'stage-1',name:'Nowy klient'},{id:'stage-2',name:'Czeka na kalkulację'}]}
      onChange={(key,value)=>setValues(current=>({...current,[key]:value}))}
      onAddressChange={investmentAddress=>setValues(current=>({...current,investmentAddress,latitude:'',longitude:''}))}
      onLocationSelect={result=>setValues(current=>({...current,investmentAddress:result.address,latitude:String(result.latitude),longitude:String(result.longitude)}))}
      onStageChange={stageId=>setValues(current=>({...current,stageId}))}
      onSave={()=>{setSaved(values);setMessage('Zapisano lokalnie');}}
      onCancel={()=>{setValues(current=>resetClientDetails(current,saved));setMessage('Przywrócono zapisane wartości');}}
    />
  </Box>;
}
