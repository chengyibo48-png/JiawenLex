"use client";
import { useEffect, useRef, useState } from "react";
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, MapPin, Moon, RefreshCw, Search, Sun, X } from "lucide-react";

type City = { id: number; name: string; latitude: number; longitude: number; admin1?: string; country?: string };
type Weather = { temperature: number; code: number; day: boolean; time: string };
function validCity(value: unknown): value is City {
  if (!value || typeof value !== "object") return false;
  const c = value as City;
  return Number.isInteger(c.id) && typeof c.name === "string" && c.name.length > 0 && c.name.length < 200 && Number.isFinite(c.latitude) && Math.abs(c.latitude) <= 90 && Number.isFinite(c.longitude) && Math.abs(c.longitude) <= 180;
}
function weatherDescription(code: number, zh: boolean) {
  const pair = code === 0 ? ["晴", "Clear"] : code <= 3 ? ["多云", "Cloudy"] : [45,48].includes(code) ? ["雾", "Fog"] : [71,73,75,77,85,86].includes(code) ? ["雪", "Snow"] : [95,96,99].includes(code) ? ["雷雨", "Thunderstorm"] : [51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code) ? ["雨", "Rain"] : ["天气", "Weather"];
  return pair[zh ? 0 : 1];
}
export function WeatherWidget({ userId, language }: { userId: string; language: "zh" | "en" }) {
  const zh = language === "zh", key = `jiawenlex-weather:${userId}`;
  const [city,setCity] = useState<City|null>(null), [weather,setWeather] = useState<Weather|null>(null);
  const [open,setOpen] = useState(false), [query,setQuery] = useState(""), [results,setResults] = useState<City[]>([]);
  const [loading,setLoading] = useState(false), [searching,setSearching] = useState(false), [error,setError] = useState(""), [searchError,setSearchError] = useState("");
  const [refresh,setRefresh] = useState(0);
  const searchRequest = useRef<AbortController|null>(null);
  const panel = useRef<HTMLDivElement>(null), toggle = useRef<HTMLButtonElement>(null), searchInput = useRef<HTMLInputElement>(null);
  useEffect(()=>{setCity(null);setWeather(null);setError("");setOpen(false);try{const raw=localStorage.getItem(key);if(raw){const saved:unknown=JSON.parse(raw);if(validCity(saved))setCity(saved);}}catch{/* Weather is optional when storage is unavailable. */}},[key]);
  useEffect(()=>{if(!open)return;searchInput.current?.focus();const dismiss=(e:KeyboardEvent)=>{if(e.key==="Escape"){setOpen(false);toggle.current?.focus();}};const outside=(e:PointerEvent)=>{if(e.target instanceof Node&&!panel.current?.contains(e.target)&&!toggle.current?.contains(e.target))setOpen(false);};document.addEventListener("keydown",dismiss);document.addEventListener("pointerdown",outside);return()=>{document.removeEventListener("keydown",dismiss);document.removeEventListener("pointerdown",outside);};},[open]);
  useEffect(()=>()=>searchRequest.current?.abort(),[]);
  useEffect(()=>{
    setWeather(null);setError("");if(!city)return;
    let request:AbortController|null=null, disposed=false;
    const fetchWeather=async()=>{
      if(document.hidden)return;
      request?.abort();const controller=new AbortController();request=controller;
      const timeout=window.setTimeout(()=>controller.abort(),12000);setLoading(true);
      try{
        const params=new URLSearchParams({latitude:String(city.latitude),longitude:String(city.longitude),current:"temperature_2m,weather_code,is_day",timezone:"auto",forecast_days:"1"});
        const response=await fetch(`https://api.open-meteo.com/v1/forecast?${params}`,{signal:controller.signal});if(!response.ok)throw Error("weather");
        const value=await response.json(), current=value.current;
        if(!current||!Number.isFinite(current.temperature_2m)||!Number.isInteger(current.weather_code)||![0,1].includes(current.is_day)||typeof current.time!=="string")throw Error("weather");
        if(!disposed&&request===controller){setWeather({temperature:current.temperature_2m,code:current.weather_code,day:current.is_day===1,time:current.time});setError("");}
      }catch{if(!disposed&&request===controller){setWeather(null);setError(zh?"天气暂不可用，点击重试":"Weather unavailable; retry");}}
      finally{window.clearTimeout(timeout);if(!disposed&&request===controller)setLoading(false);}
    };
    void fetchWeather();const timer=window.setInterval(()=>void fetchWeather(),15*60*1000);
    const visible=()=>{if(!document.hidden)void fetchWeather();};document.addEventListener("visibilitychange",visible);
    return()=>{disposed=true;request?.abort();window.clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
  },[city,refresh,zh]);
  async function searchCities() {
    if(query.trim().length<2){setSearchError(zh?"请至少输入两个字或字母":"Enter at least two characters");return;}
    searchRequest.current?.abort();const controller=new AbortController();searchRequest.current=controller;
    const timeout=window.setTimeout(()=>controller.abort(),12000);setSearching(true);setSearchError("");setResults([]);
    try{const params=new URLSearchParams({name:query.trim(),count:"5",language:zh?"zh":"en",format:"json"});const response=await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`,{signal:controller.signal});if(!response.ok)throw Error("cities");const data=await response.json();if(searchRequest.current!==controller)return;const found=Array.isArray(data.results)?data.results.filter(validCity):[];setResults(found);if(!found.length)setSearchError(zh?"未找到城市，可以试试英文名":"No city found; try another name");}
    catch{if(searchRequest.current===controller)setSearchError(zh?"城市查询失败，请重试":"City search failed; retry");}
    finally{window.clearTimeout(timeout);if(searchRequest.current===controller)setSearching(false);}
  }
  function selectCity(next:City|null){searchRequest.current?.abort();searchRequest.current=null;setSearching(false);setCity(next);setOpen(false);setResults([]);setSearchError("");try{if(next)localStorage.setItem(key,JSON.stringify(next));else localStorage.removeItem(key);}catch{/* Continue for this visit without persistence. */}toggle.current?.focus();}
  const Icon = !weather ? Cloud : weather.code===0 ? weather.day?Sun:Moon : [45,48].includes(weather.code)?CloudFog:[71,73,75,77,85,86].includes(weather.code)?CloudSnow:[95,96,99].includes(weather.code)?CloudLightning:[51,53,55,56,57,61,63,65,66,67,80,81,82].includes(weather.code)?CloudRain:Cloud;
  return <div className="weather-widget">
    <button ref={toggle} className="weather-toggle" aria-expanded={open} aria-controls="weather-settings" onClick={()=>setOpen(v=>!v)} title={zh?"选择天气城市":"Choose weather city"}><Icon size={21}/><span>{city?city.name:zh?"添加天气":"Add weather"}{city&&weather&&<strong>{Math.round(weather.temperature)}°C · {weatherDescription(weather.code,zh)}</strong>}{city&&loading&&!weather&&<small>{zh?"更新中…":"Updating…"}</small>}</span></button>
    {error&&<button className="weather-retry" onClick={()=>setRefresh(v=>v+1)} title={error} aria-label={error}><RefreshCw size={16}/><span>{zh?"重试":"Retry"}</span></button>}
    {open&&<div ref={panel} id="weather-settings" className="weather-panel" role="region" aria-label={zh?"天气设置":"Weather settings"}>
      <div className="card-top"><strong><MapPin size={16}/>{zh?"选择城市":"Choose a city"}</strong><button className="icon-button" aria-label={zh?"关闭":"Close"} onClick={()=>{setOpen(false);toggle.current?.focus();}}><X size={16}/></button></div>
      <form onSubmit={e=>{e.preventDefault();void searchCities();}}><label>{zh?"城市名称":"City name"}<input ref={searchInput} value={query} maxLength={100} onChange={e=>{searchRequest.current?.abort();searchRequest.current=null;setSearching(false);setResults([]);setSearchError("");setQuery(e.target.value);}} placeholder={zh?"例如：上海 / Shanghai":"e.g. Shanghai"}/></label><button className="button secondary small" disabled={searching} type="submit"><Search size={16}/>{searching?zh?"查询中":"Searching":zh?"查询":"Search"}</button></form>
      {searchError&&<p role="status" className="muted small">{searchError}</p>}
      {results.map(result=><button className="weather-city" key={result.id} onClick={()=>selectCity(result)}><strong>{result.name}</strong><small>{[result.admin1,result.country].filter(Boolean).join(" · ")}</small></button>)}
      {city&&<button className="text-action" onClick={()=>selectCity(null)}>{zh?"关闭天气显示":"Disable weather"}</button>}
      <p className="muted small">{zh?"城市仅保存在本机，不读取定位；每15分钟刷新模型天气。":"City saved on this device; no geolocation. Model weather refreshed every 15 minutes."}{weather&&` · ${weather.time.slice(11,16)} ${zh?"城市当地时间":"city local time"}`}</p>
      <small className="weather-attribution"><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a></small>
    </div>}
  </div>;
}
